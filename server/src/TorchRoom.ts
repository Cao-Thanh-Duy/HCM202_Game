import { Room, Client, Delayed } from '@colyseus/core';
import { GameState, Player } from './schema';
import { DEFAULT_QUESTIONS, sanitize, Question } from './questions';
import { CFG, ZONES, zoneAt, respawnOf, TEAM_COLORS } from '../../shared/config';

const usedCodes = new Set<string>();
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const shuffle = (n: number) => {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Trạng thái riêng từng người (không đồng bộ xuống client)
// pool = câu chưa trả lời; cur = câu đang hiện (-1 = không có); lastExpired = câu vừa hết giờ (tránh random trúng lại ngay)
interface Priv { pool: number[]; cur: number; lastExpired: number; shownAt: number; locked: boolean; timer?: Delayed; qTimer?: Delayed }

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
  colorIdx = 0;

  onCreate() {
    let code: string;
    do code = String(Math.floor(1000 + Math.random() * 9000)); while (usedCodes.has(code));
    usedCodes.add(code);
    this.roomId = code;              // mã phòng = roomId -> client dùng joinById(code)
    this.state.code = code;
    this.state.total = this.questions.length;
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
    p.z = (Math.random() - 0.5) * 24; // rải ở vạch xuất phát cho khỏi chồng nhau
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
  newPriv(): Priv { return { pool: shuffle(this.questions.length), cur: -1, lastExpired: -1, shownAt: 0, locked: false }; }

  sendQuestion(c: Client) {
    const p = this.state.players.get(c.sessionId), pv = this.priv.get(c.sessionId);
    if (!p || !pv) return;
    if (!pv.pool.length) { c.send('q', null); return; } // hết câu
    // ⚠️ Đang có câu dở (F5/needQ) thì gửi lại ĐÚNG câu đó, KHÔNG reset giờ -> chống spam needQ để đổi câu / ăn thưởng nhanh
    if (pv.cur < 0) {
      const choices = pv.pool.length > 1 ? pv.pool.filter(i => i !== pv.lastExpired) : pv.pool;
      pv.cur = choices[Math.floor(Math.random() * choices.length)];
      pv.shownAt = Date.now();
      pv.qTimer?.clear();
      pv.qTimer = this.clock.setTimeout(() => this.expire(c), CFG.QUESTION_MS);
    }
    pv.locked = false;
    const Q = this.questions[pv.cur];
    c.send('q', { n: p.qDone + 1, total: this.questions.length, q: Q.q, options: Q.options, endsAt: pv.shownAt + CFG.QUESTION_MS }); // KHÔNG gửi đáp án
  }

  // Hết 20s không trả lời: câu quay lại pool, client tự đóng panel; mở lại sẽ random câu KHÁC
  expire(c: Client) {
    const pv = this.priv.get(c.sessionId);
    if (!pv || pv.cur < 0 || pv.locked) return;
    pv.lastExpired = pv.cur; pv.cur = -1;
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
      if (p.zone) gain += CFG.ZONE_STAMINA_BONUS; // thưởng khu tính theo vị trí LÚC trả lời
      p.qRight++;
    }
    p.stamina += gain;
    p.qDone++;
    pv.pool = pv.pool.filter(i => i !== qi); pv.cur = -1;
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
        p.x = Math.max(0, Math.min(CFG.MAP_LENGTH, p.x + inp.x * step));
        p.z = Math.max(-CFG.MAP_HALF_WIDTH, Math.min(CFG.MAP_HALF_WIDTH, p.z + inp.z * step));
        const moved = Math.hypot(p.x - ox, p.z - oz); // trừ theo quãng THẬT (bị chặn biên thì không mất)
        p.stamina = Math.max(0, p.stamina - moved);
        p.rot = Math.atan2(inp.x, inp.z);
        p.zone = zoneAt(p.x, p.z);
        if (p.zone > p.cpZone) { p.cpZone = p.zone; this.broadcast('checkpoint', { id, zone: p.zone }); }
        if (p.x >= CFG.MAP_LENGTH) { p.rank = ++this.finishCount; this.broadcast('finish', { id, rank: p.rank }); }
      }

      // Luật đuốc: deadline riêng từng người = lúc tắt + grace + bù ping (có trần)
      if (s.torch === 'off' && !p.stunned) {
        const comp = Math.min((this.rtt.get(id) ?? 0) / 2, CFG.MAX_LAG_COMP_MS);
        if (now < this.offAt + CFG.GRACE_MS + comp) return;
        const sp = this.snap.get(id);
        if (!sp) { this.snap.set(id, { x: p.x, z: p.z }); return; }
        if (Math.hypot(p.x - sp.x, p.z - sp.z) > CFG.MOVE_EPS) {
          const r = respawnOf(p.cpZone); // về khu đã vào gần nhất, chưa vào khu nào -> vạch xuất phát
          p.x = r.x; p.z = r.z; p.zone = zoneAt(p.x, p.z);
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

  exportStats() {
    const players: any[] = [];
    this.state.players.forEach(p => players.push({
      name: p.name, x: +p.x.toFixed(1), rank: p.rank, answered: p.qDone, correct: p.qRight, caught: p.caught,
    }));
    return {
      zones: ZONES.map(z => z.name),
      questions: this.questions.map((q, i) => ({ q: q.q, options: q.options, correct: q.a, counts: this.stats[i] ?? [] })),
      players,
    };
  }
}
