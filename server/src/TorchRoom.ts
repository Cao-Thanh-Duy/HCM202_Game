import { Room, Client, Delayed } from '@colyseus/core';
import { GameState, Player, Trap } from './schema';
import { DEFAULT_QUESTIONS, sanitize, Question } from './questions';
import { CFG, ZONES, TEAM_COLORS } from '../../shared/config';
import { toWorld, clampToRoad, zoneAtSD, respawnOf, project } from '../../shared/path';

const usedCodes = new Set<string>();
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const shuffle = (n: number) => {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Trạng thái riêng từng người (không đồng bộ xuống client)
// bag = "túi" câu của vòng hiện tại (rút hết 20 câu theo thứ tự ngẫu nhiên rồi xáo lại -> KHÔNG giới hạn số câu, ít lặp)
// cur = câu đang hiện (-1 = không có); last = câu vừa hiện (tránh vòng mới rút trúng ngay câu đó)
interface Priv { bag: number[]; cur: number; last: number; shownAt: number; locked: boolean; timer?: Delayed; qTimer?: Delayed }

export class TorchRoom extends Room<GameState> {
  maxClients = CFG.MAX_PLAYERS + 1; // +1 cho host
  state = new GameState();

  hostId = '';
  questions: Question[] = DEFAULT_QUESTIONS;
  priv = new Map<string, Priv>();
  inputs = new Map<string, { x: number; z: number }>();
  rtt = new Map<string, number>();
  snap = new Map<string, { x: number; z: number }>(); // vị trí tại deadline lúc đuốc tắt
  stats: number[][] = [];
  torchTimers: Delayed[] = [];
  endTimer?: Delayed;
  offAt = 0;
  finishCount = 0;
  immune = new Map<string, number>();             // miễn bẫy tới thời điểm (ms)
  fenceHits = new Map<string, Set<number>>();     // hàng rào đã đâm (mỗi cái chỉ phạt 1 lần, reset khi bị đưa về sau)
  bombPos: { x: number; z: number }[] = [];
  colorIdx = 0;

  onCreate() {
    let code: string;
    do code = String(Math.floor(1000 + Math.random() * 9000)); while (usedCodes.has(code));
    usedCodes.add(code);
    this.roomId = code;              // mã phòng = roomId -> client dùng joinById(code)
    this.state.code = code;
    this.state.total = this.questions.length;
    this.genTraps();
    this.setPatchRate(CFG.TICK_MS);
    this.setSimulationInterval(dt => this.tick(dt), CFG.TICK_MS);

    this.onMessage('input', (c, m: { x: number; z: number }) => {
      // Chuẩn hóa ở server, không tin client gửi vector > 1 (hack tốc độ)
      const len = Math.hypot(m?.x || 0, m?.z || 0);
      this.inputs.set(c.sessionId, len > 0 ? { x: m.x / len, z: m.z / len } : { x: 0, z: 0 });
    });
    this.onMessage('ping', (c, m: { t: number; rtt?: number }) => {
      if (m.rtt) this.rtt.set(c.sessionId, m.rtt);
      c.send('pong', { t: m.t, s: Date.now() });
    });
    this.onMessage('answer', (c, choice: number) => this.onAnswer(c, choice));
    // Client vừa gắn handler xong (F5/reconnect) -> xin lại câu đang dở, tránh mất message gửi quá sớm
    this.onMessage('needQ', c => { if (this.state.phase === 'play' && !this.priv.get(c.sessionId)?.locked) this.sendQuestion(c); });
    this.onMessage('start', c => { if (c.sessionId === this.hostId && this.state.phase === 'lobby') this.startGame(); });
    this.onMessage('end', c => { if (c.sessionId === this.hostId && this.state.phase === 'play') this.endGame(); });
    this.onMessage('stats', c => c.send('stats', this.exportStats()));
    // Host import bộ câu hỏi (client đã parse JSON/CSV -> mảng). Chỉ cho đổi khi đang ở sảnh.
    this.onMessage('questions', (c, raw) => {
      if (c.sessionId !== this.hostId || this.state.phase !== 'lobby') return;
      const qs = sanitize(raw);
      if (qs.length) { this.questions = qs; this.state.total = qs.length; }
      c.send('questionsLoaded', { ok: qs.length, total: Array.isArray(raw) ? raw.length : 0 });
    });
  }

  onJoin(c: Client, opts: { host?: boolean; name?: string }) {
    if (opts.host && !this.hostId) { this.hostId = c.sessionId; return; }
    const p = new Player();
    p.name = String(opts.name || 'Nhóm ?').slice(0, 16);
    p.color = this.colorIdx++ % TEAM_COLORS.length;
    const sp = toWorld(0.5, (Math.random() - 0.5) * 12); // rải ngang vạch xuất phát cho khỏi chồng nhau
    p.x = sp.x; p.z = sp.z;
    this.fenceHits.set(c.sessionId, new Set());
    this.state.players.set(c.sessionId, p);
    this.priv.set(c.sessionId, this.newPriv());
    if (this.state.phase === 'play') this.sendQuestion(c); // vào muộn vẫn chơi được
  }

  async onLeave(c: Client, consented: boolean) {
    const p = this.state.players.get(c.sessionId);
    this.inputs.set(c.sessionId, { x: 0, z: 0 }); // ⚠️ rớt mạng khi đang giữ phím -> phải dừng, không thì chạy mãi
    if (p) p.online = false;
    if (consented) return;
    try {
      await this.allowReconnection(c, 120);
      if (p) p.online = true;
      if (this.state.phase === 'play' && p) this.sendQuestion(c); // gửi lại câu đang dở
    } catch { /* hết hạn: giữ player trong state để bảng xếp hạng không mất người */ }
  }

  onDispose() { usedCodes.delete(this.state.code); }

  // ---------------- GAME FLOW ----------------
  startGame() {
    // Bộ câu có thể đã đổi sau khi người chơi vào -> xáo lại thứ tự theo bộ mới
    this.priv.forEach((pv, id) => { pv.qTimer?.clear(); this.priv.set(id, this.newPriv()); });
    this.stats = this.questions.map(q => q.options.map(() => 0));
    this.state.phase = 'play';
    this.state.phaseEnd = Date.now() + CFG.GAME_MS;
    this.endTimer = this.clock.setTimeout(() => this.endGame(), CFG.GAME_MS);
    this.torchOn();
    this.clients.forEach(c => c.sessionId !== this.hostId && this.sendQuestion(c));
  }

  endGame() {
    this.state.phase = 'end';
    this.state.phaseEnd = Date.now();
    this.endTimer?.clear();
    this.torchTimers.forEach(t => t.clear());
    this.priv.forEach(pv => { pv.timer?.clear(); pv.qTimer?.clear(); });
    this.state.torch = 'on';
  }

  // ---------------- QUESTIONS (riêng từng người) ----------------
  newPriv(): Priv { return { bag: shuffle(this.questions.length), cur: -1, last: -1, shownAt: 0, locked: false }; }

  // Rút 1 câu từ túi; túi rỗng thì xáo lại cả bộ (đảo nếu câu đầu trùng câu vừa hiện)
  draw(pv: Priv) {
    if (!pv.bag.length) {
      pv.bag = shuffle(this.questions.length);
      if (pv.bag.length > 1 && pv.bag[pv.bag.length - 1] === pv.last) pv.bag.unshift(pv.bag.pop()!);
    }
    return pv.bag.pop()!;
  }

  sendQuestion(c: Client) {
    const p = this.state.players.get(c.sessionId), pv = this.priv.get(c.sessionId);
    if (!p || !pv) return;
    // ⚠️ Đang có câu dở (F5/needQ) thì gửi lại ĐÚNG câu đó, KHÔNG reset giờ -> chống spam needQ để đổi câu / ăn thưởng nhanh
    if (pv.cur < 0) {
      pv.cur = this.draw(pv); pv.last = pv.cur;
      pv.shownAt = Date.now();
      pv.qTimer?.clear();
      pv.qTimer = this.clock.setTimeout(() => this.expire(c), CFG.QUESTION_MS);
    }
    pv.locked = false;
    const Q = this.questions[pv.cur];
    c.send('q', { n: p.qDone + 1, q: Q.q, options: Q.options, endsAt: pv.shownAt + CFG.QUESTION_MS }); // KHÔNG gửi đáp án
  }

  // Hết 20s không trả lời: câu bị lỡ nhét lại ĐÁY túi (sẽ gặp lại sau), client tự đóng panel; mở lại ra câu KHÁC
  expire(c: Client) {
    const pv = this.priv.get(c.sessionId);
    if (!pv || pv.cur < 0 || pv.locked) return;
    pv.bag.unshift(pv.cur); pv.cur = -1;
    c.send('qTimeout');
  }

  onAnswer(c: Client, choice: number) {
    const p = this.state.players.get(c.sessionId), pv = this.priv.get(c.sessionId);
    if (!p || !pv || this.state.phase !== 'play' || pv.locked || pv.cur < 0) return;
    const qi = pv.cur, Q = this.questions[qi];
    if (!(choice >= 0 && choice < Q.options.length)) return;
    pv.locked = true; // chặn bấm 2 lần
    pv.qTimer?.clear();

    let gain = 0;
    if (choice === Q.a) {
      const t = Math.min(1, (Date.now() - pv.shownAt) / CFG.SPEED_WINDOW_MS);
      gain = Math.round(CFG.STAMINA_MIN_Q + (CFG.STAMINA_MAX_Q - CFG.STAMINA_MIN_Q) * (1 - t));
      if (p.zone) gain += ZONES[p.zone - 1].bonus; // thưởng khu (5/7/10) tính theo vị trí LÚC trả lời
      p.qRight++;
    }
    p.stamina += gain;
    p.qDone++;
    pv.cur = -1;
    this.stats[qi][choice]++;
    c.send('result', { choice, a: Q.a, quote: Q.quote ?? '', gain, zone: p.zone });
    // Server tự đẩy câu kế sau RESULT_MS -> client không skip được phần trích dẫn
    pv.timer = this.clock.setTimeout(() => this.sendQuestion(c), CFG.RESULT_MS);
  }

  // ---------------- TORCH ----------------
  later(ms: number, fn: () => void) { this.torchTimers.push(this.clock.setTimeout(fn, ms)); }

  torchOn() {
    this.torchTimers = [];
    this.state.torch = 'on';
    this.snap.clear();
    this.state.players.forEach(p => (p.stunned = false));
    const onMs = CFG.TORCH_ON_MS[Math.floor(Math.random() * CFG.TORCH_ON_MS.length)]; // chọn 1 trong 3 mốc
    this.later(onMs, () => {
      this.state.torch = 'dim';
      this.later(CFG.TORCH_DIM_MS, () => {
        this.state.torch = 'off';
        this.offAt = Date.now();
        this.later(rand(CFG.TORCH_OFF_MS), () => this.torchOn());
      });
    });
  }

  // ---------------- SIMULATION ----------------
  tick(dt: number) {
    const s = this.state;
    if (s.phase !== 'play') return;
    const now = Date.now(), sec = dt / 1000;

    s.players.forEach((p, id) => {
      if (p.rank) return;
      const inp = this.inputs.get(id);
      if (inp && (inp.x || inp.z) && !p.stunned && p.stamina > 0) {
        const speed = CFG.BASE_SPEED * (p.zone ? 1 + CFG.ZONE_SPEED_BONUS : 1);
        const step = Math.min(speed * sec, p.stamina);
        const ox = p.x, oz = p.z;
        // Đi tự do 2D rồi kẹp lại trong lòng đường
        const r = clampToRoad(p.x + inp.x * step, p.z + inp.z * step);
        p.x = r.x; p.z = r.z; p.prog = r.s;
        const moved = Math.hypot(p.x - ox, p.z - oz); // trừ theo quãng THẬT (bị chặn mép thì không mất)
        p.stamina = Math.max(0, p.stamina - moved);
        p.rot = Math.atan2(inp.x, inp.z);
        p.zone = zoneAtSD(r.s, r.d);
        if (p.zone > p.cpZone) { p.cpZone = p.zone; this.broadcast('checkpoint', { id, zone: p.zone }); }
        if (p.prog >= CFG.MAP_LENGTH - 0.3) { p.rank = ++this.finishCount; this.broadcast('finish', { id, rank: p.rank }); return; }
        if (now > (this.immune.get(id) ?? 0)) this.checkTraps(p, id, r.s, r.d);
      }

      // Luật đuốc: deadline riêng từng người = lúc tắt + grace + bù ping (có trần)
      if (s.torch === 'off' && !p.stunned) {
        const comp = Math.min((this.rtt.get(id) ?? 0) / 2, CFG.MAX_LAG_COMP_MS);
        if (now < this.offAt + CFG.GRACE_MS + comp) return;
        const sp = this.snap.get(id);
        if (!sp) { this.snap.set(id, { x: p.x, z: p.z }); return; }
        if (Math.hypot(p.x - sp.x, p.z - sp.z) > CFG.MOVE_EPS) {
          this.respawn(p, id);
          p.stunned = true; p.caught++;
          this.broadcast('caught', { id, cpZone: p.cpZone });
        }
      }
    });

    // Tất cả người chơi về đích -> kết thúc sớm
    let done = s.players.size > 0;
    s.players.forEach(p => { if (!p.rank) done = false; });
    if (done) this.endGame();
  }

  // ---------------- TRAPS ----------------
  // Random vị trí bẫy mỗi phòng: tránh vạch xuất phát/đích, tránh 3 khu, các bẫy không sát nhau
  genTraps() {
    const L = CFG.MAP_LENGTH, HW = CFG.ROAD_HALF_WIDTH, used: number[] = [];
    const free = (s: number, gap: number) => !ZONES.some(z => s > z.s0 - 4 && s < z.s1 + 4) && used.every(u => Math.abs(u - s) > gap);
    const pick = (gap: number) => { for (let k = 0; k < 200; k++) { const s = 15 + Math.random() * (L - 30); if (free(s, gap)) { used.push(s); return s; } } return -1; };
    for (let i = 0; i < CFG.FENCES; i++) {
      const s = pick(10); if (s < 0) continue;
      const t = new Trap(); t.kind = 'fence'; t.s = s;
      // Chắn nửa đường (trái hoặc phải) -> luôn có lối đi vòng
      if (i % 2) { t.d0 = -HW; t.d1 = 0.5; } else { t.d0 = -0.5; t.d1 = HW; }
      this.state.traps.push(t);
    }
    for (let i = 0; i < CFG.BOMBS; i++) {
      const s = pick(4); if (s < 0) continue;
      const t = new Trap(); t.kind = 'bomb'; t.s = s; t.d0 = (Math.random() * 2 - 1) * (HW - 1.5);
      this.state.traps.push(t);
    }
    this.bombPos = this.state.traps.map(t => (t.kind === 'bomb' ? toWorld(t.s, t.d0) : { x: NaN, z: NaN }));
  }

  checkTraps(p: Player, id: string, s: number, d: number) {
    this.state.traps.forEach((t, i) => {
      if (t.kind === 'bomb') {
        const b = this.bombPos[i];
        if (Math.hypot(p.x - b.x, p.z - b.z) < CFG.BOMB_RADIUS) {
          this.respawn(p, id); // dính bom -> về checkpoint (chưa có -> vạch xuất phát)
          this.broadcast('bomb', { id, i, cpZone: p.cpZone });
        }
      } else {
        const hits = this.fenceHits.get(id)!;
        if (!hits.has(i) && Math.abs(s - t.s) < 0.6 && d >= t.d0 && d <= t.d1) {
          hits.add(i);
          const lost = p.stamina * (1 - CFG.FENCE_STAMINA_MUL);
          p.stamina *= CFG.FENCE_STAMINA_MUL; // đâm hàng rào -> còn 50% stamina
          this.broadcast('fence', { id, i, lost: Math.round(lost) });
        }
      }
    });
  }

  // Đưa về checkpoint + miễn bẫy ngắn; hàng rào phía trước điểm hồi sinh được tính phạt lại
  respawn(p: Player, id: string) {
    const r = respawnOf(p.cpZone);
    p.x = r.x; p.z = r.z;
    const pr = project(r.x, r.z);
    p.prog = pr.s; p.zone = zoneAtSD(pr.s, pr.d);
    this.immune.set(id, Date.now() + CFG.TRAP_IMMUNE_MS);
    const hits = this.fenceHits.get(id);
    this.state.traps.forEach((t, i) => { if (t.s > pr.s) hits?.delete(i); });
  }

  exportStats() {
    const players: any[] = [];
    this.state.players.forEach(p => players.push({
      name: p.name, distance: +p.prog.toFixed(1), rank: p.rank, answered: p.qDone, correct: p.qRight, caught: p.caught,
    }));
    return {
      zones: ZONES.map(z => z.name),
      questions: this.questions.map((q, i) => ({ q: q.q, options: q.options, correct: q.a, counts: this.stats[i] ?? [] })),
      players,
    };
  }
}
