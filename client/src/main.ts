import './style.css';
import * as THREE from 'three';
import QRCode from 'qrcode';
import { CFG, ZONES, TEAM_COLORS } from '../../shared/config';
import { zoneAt, clampToRoad } from '../../shared/path';
import { room, createRoom, joinRoom, tryReconnect, forgetSession, serverNow } from './net';
// ⚠️ Đợi font Baloo 2 tải xong rồi mới dựng scene: chữ 3D vẽ bằng canvas, vẽ sớm sẽ dính font dự phòng
await Promise.race([document.fonts.load('800 40px "Baloo 2"'), new Promise(r => setTimeout(r, 2000))]);
const { startLoop, upsertAvatar, getAvatar, setTorch, setFollow, checkpointFx, hostCam, bindHostControls, buildTraps, boomFx, fenceFx, camDir } = await import('./world');
import { readQuestionFile } from './importer';
import { unlock, sfx, toggleMute, music, duck, resumeOnClick, setVolume, vol } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on = true) => $(id).classList.toggle('hidden', !on);
// ⚠️ Tên người chơi do người dùng nhập -> escape trước khi nhét vào innerHTML
const esc = (t: string) => t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => '#' + TEAM_COLORS[c].toString(16).padStart(6, '0');
let isHost = false;

function toast(msg: string, ms = 2500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.classList.remove('show'), ms);
}

// Luật chơi: 1 nguồn, hiện ở sảnh + khung hướng dẫn
const RULES = [
  `<b>❓ Trả lời</b> (phím 1–4) bất cứ lúc nào để tích stamina: mỗi câu <b>${CFG.QUESTION_MS / 1000}s</b>, đúng nhanh <b>+${CFG.STAMINA_MAX_Q}</b>, chậm <b>+${CFG.STAMINA_MIN_Q}</b>, sai +0 · hết giờ thì bấm Q lấy câu khác`,
  `<b>🏃 WASD</b> di chuyển · 1 stamina = 1m · hết stamina tự mở câu hỏi`,
  `<b>🔥 Sáng</b>: đi · <b>⚠️ Tối dần</b> (1s): chuẩn bị dừng · <b>⛔ Tắt</b>: đứng yên`,
  `<b>✨ Đứng trong khu</b> khi trả lời đúng: ${ZONES.map(z => `<b>${z.name} +${z.bonus}⚡</b>`).join(' · ')} mỗi câu · <b>+${CFG.ZONE_SPEED_BONUS * 100}%</b> tốc độ · <b>lưu checkpoint</b>`,
  `<b>💀 Đi khi đuốc tắt</b> hoặc <b>💣 dính bom</b> → về khu gần nhất đã vào; chưa vào khu nào → <b>về vạch xuất phát</b>`,
  `<b>🚧 Vướng hàng rào gai</b> → mất <b>${(1 - CFG.FENCE_STAMINA_MUL) * 100}%</b> stamina (rào gai chỉ chắn nửa đường, đi vòng được)`,
].map(r => `<div>${r}</div>`).join('');
document.querySelectorAll('[data-rules]').forEach(el => (el.innerHTML = RULES));

// ================= MENU =================
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) { $<HTMLInputElement>('code').value = urlCode; $('name').focus(); } // vào từ QR: điền sẵn mã

$('code').oninput = e => ((e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.replace(/\D/g, ''));
$('btnJoin').onclick = async () => {
  const name = $<HTMLInputElement>('name').value.trim(), code = $<HTMLInputElement>('code').value.trim();
  if (!name || code.length !== 4) return ($('menuErr').textContent = 'Nhập tên và mã phòng 4 số');
  try { await joinRoom(code, name); enter(false); } catch { $('menuErr').textContent = 'Không tìm thấy phòng hoặc phòng đã đầy'; }
};
$('name').onkeydown = e => { if (e.key === 'Enter') $('btnJoin').click(); };
$('btnHost').onclick = async () => {
  unlock(); // ⚠️ phải gọi trong click, nếu không trình duyệt chặn âm thanh
  try { await createRoom(); enter(true); } catch { $('menuErr').textContent = 'Không kết nối được server'; }
};
$('btnLeave').onclick = () => { forgetSession(); room?.leave(); location.href = location.pathname; };

// Import câu hỏi (host, trong sảnh)
$<HTMLInputElement>('qFile').onchange = async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f || !room) return;
  try { room.send('questions', await readQuestionFile(f)); }
  catch { $('qInfo').textContent = '❌ File lỗi định dạng'; }
};
$('btnStart').onclick = () => room?.send('start');
$('btnEnd').onclick = () => { if (confirm('Kết thúc ván ngay?')) room?.send('end'); };
$('btnCam').onclick = () => {
  hostCam.mode = hostCam.mode === 'fit' ? 'map' : 'fit';
  Object.assign(hostCam, { zoom: 1, panX: 0, panZ: 0 });
  $('btnCam').textContent = hostCam.mode === 'fit' ? '🎯 Bám người chơi' : '🗺 Toàn bản đồ';
};
// Bảng âm thanh host: có 2 bản (sảnh + trong ván), đồng bộ giá trị với nhau
function bindSound() {
  document.querySelectorAll<HTMLElement>('.sndCtl').forEach(box => {
    box.querySelector<HTMLButtonElement>('.sndMute')!.onclick = () => {
      const m = toggleMute();
      document.querySelectorAll('.sndMute').forEach(b => { b.textContent = m ? '🔇' : '🔊'; b.classList.toggle('off', m); });
    };
    box.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => {
      const kind = r.dataset.kind as 'music' | 'sfx';
      r.value = String(Math.round(vol[kind] * 100));
      r.style.setProperty('--fill', r.value + '%');
      r.oninput = () => {
        setVolume(kind, +r.value / 100);
        document.querySelectorAll<HTMLInputElement>(`input[data-kind=${kind}]`).forEach(o => { o.value = r.value; o.style.setProperty('--fill', r.value + '%'); });
      };
    });
  });
}
bindSound();
$('btnStats').onclick = () => room?.send('stats');

// ================= ROOM =================
function enter(host: boolean) {
  isHost = host;
  document.body.classList.toggle('host', host);
  show('menu', false);
  const r = room!;
  if (!host) setFollow(r.sessionId); else bindHostControls();
  const nameOf = (id: string) => r.state.players.get(id)?.name ?? '?';

  r.onMessage('q', onQuestion);
  r.onMessage('qTimeout', () => {
    curQ = null; qLocked = true; suppressAuto = true;
    setQuizOpen(false);
    $('qOpen').textContent = '❓ Câu hỏi mới (Q)';
    toast('⏰ Hết 20s! Bấm Q hoặc nút Câu hỏi để lấy câu khác', 3000);
  });
  r.onMessage('result', onResult);
  r.onMessage('caught', ({ id, cpZone }) => {
    const where = cpZone ? ZONES[cpZone - 1].name : 'vạch xuất phát';
    if (id === r.sessionId) { popup('caught', '💀 BỊ BẮT!', `Đi khi đuốc tắt → hồi sinh tại ${where}`, 2600); predInit = false; lastZone = cpZone; }
    else if (isHost) { toast(`${nameOf(id)} bị bắt → ${where}`, 1500); sfx.caught(); }
  });
  r.onMessage('bomb', ({ id, i, cpZone }) => {
    const where = cpZone ? ZONES[cpZone - 1].name : 'vạch xuất phát';
    boomFx(i);
    if (id === r.sessionId) { popup('caught', '💣 DÍNH BOM!', `Bị đưa về ${where}`, 2600); predInit = false; lastZone = cpZone; }
    else if (isHost) toast(`💣 ${nameOf(id)} dính bom → ${where}`, 1500);
    if (isHost) sfx.bomb();
  });
  r.onMessage('fence', ({ id, i, lost }) => {
    fenceFx(i);
    if (id === r.sessionId) popup('caught', '🚧 VƯỚNG RÀO GAI!', `Mất ${lost} ⚡ (còn 50%)`, 2000);
    if (isHost) sfx.fence();
  });
  r.onMessage('checkpoint', ({ id, zone }) => {
    const p = r.state.players.get(id);
    const av = getAvatar(id)?.g; // bám theo avatar đang hiển thị (không dùng state: state đi trước avatar -> lệch chỗ)
    if (p && av && (id === r.sessionId || isHost)) checkpointFx(zone, av, id === r.sessionId); // máy người khác không cần, đỡ rối
    if (id === r.sessionId) { popup('cp', '⛳ ĐÃ LƯU CHECKPOINT', `${ZONES[zone - 1].name} · bị bắt sẽ hồi sinh tại đây`, 3000); lastZone = zone; }
    if (isHost) sfx.checkpoint();
  });
  r.onMessage('finish', ({ id, rank }) => { toast(`🏁 ${nameOf(id)} về đích hạng ${rank}!`); if (isHost) sfx.finish(); });
  r.onMessage('questionsLoaded', ({ ok, total }) => ($('qInfo').textContent = `✅ Đã nạp ${ok}/${total} câu`));
  r.onMessage('stats', data => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `thongke_phong_${r.state.code}.json`; a.click();
  });
  r.onError((_c, m) => toast('Lỗi: ' + m));
  r.onLeave(code => { if (code > 1000) toast('Mất kết nối, đang thử vào lại…'); });
  r.onStateChange(onState);
  if (!host) r.send('needQ');
}

let lastPhase = '', lastTorch = '', lastCount = -1;
function onState(s: any) {
  if (!s?.players) return; // state chưa giải mã xong (vừa join/reconnect)
  if (s.traps?.length) buildTraps([...s.traps]);
  s.players.forEach((p: any, id: string) => {
    const a = upsertAvatar(id, p.name, p.color, id === room!.sessionId);
    if (id === room!.sessionId) reconcile(p); else a.target.set(p.x, 0, p.z);
    a.rot = p.rot;
  });
  setTorch(s.torch);
  if (isHost && s.phase === 'play' && s.torch !== lastTorch) {
    ({ on: sfx.torchOn, dim: sfx.torchDim, off: sfx.torchOff } as any)[s.torch]?.();
    duck(s.torch === 'on' ? 1 : s.torch === 'dim' ? 0.6 : 0.3);
  }
  lastTorch = s.torch;
  if (isHost && s.phase === 'lobby' && s.players.size > lastCount && lastCount >= 0) sfx.join();
  lastCount = s.players.size;

  if (s.phase !== lastPhase) { onPhase(s, lastPhase); lastPhase = s.phase; }
  renderHud(s);
}

function onPhase(s: any, prev: string) {
  show('lobby', s.phase === 'lobby');
  show('hud', s.phase === 'play');
  show('end', s.phase === 'end');
  setQuizOpen(!isHost && s.phase === 'play' ? true : null);
  if (s.phase === 'lobby') {
    $('lobbyCode').textContent = $('lobbyCodeP').textContent = $('lobbyCodeChip').textContent = s.code;
    const url = `${location.origin}${location.pathname}?code=${s.code}`;
    $('lobbyUrl').textContent = url;
    QRCode.toDataURL(url, { width: 520, margin: 1 }).then(d => ($<HTMLImageElement>('qr').src = d));
  }
  if (isHost) music(s.phase === 'play' ? 'ingame' : 'lobby'); // sảnh + kết quả: nhạc lobby; trong ván: nhạc ingame
  if (isHost && s.phase !== 'play') duck(1);
  if (isHost && s.phase === 'play' && prev === 'lobby') sfx.start();
  if (s.phase === 'end') { renderEnd(s); if (isHost) sfx.end(); }
}

// ================= QUIZ (tự trả lời liên tục) =================
let curQ: { n: number; q: string; options: string[] } | null = null;
let qEnds = 0, qLocked = true, quizOpen = true, outOfQ = false;
let suppressAuto = false; // vừa hết giờ tự đóng -> không tự bật lại khi hết stamina, đợi người chơi mở

// open=null: ẩn hẳn (host / ngoài ván)
function setQuizOpen(open: boolean | null) {
  quizOpen = !!open;
  show('quiz', open === true);
  show('qOpen', open === false);
  if (open) {
    suppressAuto = false;
    // Không có câu đang dở (vừa hết giờ) -> xin câu mới, server random câu KHÁC câu vừa lỡ
    if (!curQ && !outOfQ && room?.state.phase === 'play') { room.send('needQ'); $('qText').textContent = 'Đang lấy câu hỏi…'; $('qOpts').innerHTML = ''; }
  }
}
$('qToggle').onclick = () => setQuizOpen(false);
$('qOpen').onclick = () => setQuizOpen(true);

function onQuestion(q: (typeof curQ & { endsAt: number }) | null) {
  curQ = q; qLocked = !q; qEnds = q?.endsAt ?? 0;
  $('qOpen').textContent = '❓ Câu hỏi (Q)';
  show('qQuoteBox', false); $('qGain').textContent = ''; $('qGain').className = 'gain';
  const box = $('qOpts'); box.innerHTML = '';
  if (!q) {
    outOfQ = true;
    $('qNum').textContent = 'Hết câu hỏi';
    $('qText').textContent = '🎉 Bạn đã trả lời hết! Dùng stamina còn lại để về đích.';
    return;
  }
  $('qNum').textContent = `Câu ${q.n}`;
  $('qText').textContent = q.q;
  q.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = `opt opt-${'ABCD'[i]}`;
    b.innerHTML = `<span class="kk">${i + 1}</span><span></span>`;
    (b.lastChild as HTMLElement).textContent = o; // textContent: chống chèn HTML từ file câu hỏi import
    b.onclick = () => answer(i);
    box.appendChild(b);
  });
}
function answer(i: number) {
  if (qLocked || !curQ || !room) return;
  qLocked = true;
  room.send('answer', i);
  $('qOpts').children[i]?.classList.add('chosen');
}
function onResult(r: { choice: number; a: number; quote: string; gain: number; zone: number }) {
  [...$('qOpts').children].forEach((b, i) => {
    b.classList.add(i === r.a ? 'right' : i === r.choice ? 'wrong' : 'dim');
    (b as HTMLButtonElement).disabled = true;
  });
  $('qQuote').textContent = r.quote; show('qQuoteBox', !!r.quote);
  $('qGain').className = 'gain ' + (r.gain > 0 ? 'ok' : 'bad');
  $('qGain').textContent = r.gain > 0 ? `✅ +${r.gain} stamina${r.zone ? ' (có thưởng khu)' : ''}` : '❌ Sai rồi · +0';
}

// ================= HUD =================
let lastZone = 0;
// Popup giữa màn (kiểu thông báo nhiệm vụ FPS). kind đổi màu thẻ: zone | cp | caught
function popup(kind: 'zone' | 'cp' | 'caught', title: string, sub: string, ms = 2400) {
  const el = $('zonePop');
  el.className = 'zonePop ' + kind;
  el.innerHTML = `<div class="inner"><h3></h3><p></p></div>`;
  el.querySelector('h3')!.textContent = title; el.querySelector('p')!.textContent = sub;
  void el.offsetWidth; el.classList.add('show'); // ⚠️ reflow trước khi add 'show' để animation chạy lại khi popup liên tiếp
  clearTimeout((el as any)._h); (el as any)._h = setTimeout(() => el.classList.remove('show'), ms);
}
const BANNER = { on: '🔥 ĐUỐC SÁNG · ĐI!', dim: '⚠️ ĐUỐC SẮP TẮT', off: '⛔ DỪNG LẠI!' } as const;
let boardAt = 0;
const zoneBonus = (z: number) => `+${ZONES[z - 1].bonus} ⚡/câu đúng · +${CFG.ZONE_SPEED_BONUS * 100}% tốc độ`;
// Vạch 3 khu trên các thanh tiến độ: vị trí theo giữa mỗi khu / chiều dài đường
const cpMarks = ZONES.map(z => `${(((z.s0 + z.s1) / 2) / CFG.MAP_LENGTH) * 100}%`);
document.querySelectorAll<HTMLElement>('.progress span').forEach((el, i) => (el.style.left = cpMarks[i]));

function renderHud(s: any) {
  const banner = $('torchBanner');
  banner.className = 'banner ' + s.torch;
  banner.textContent = BANNER[s.torch as keyof typeof BANNER] ?? '';
  $('torchDot').className = 'tdot ' + s.torch;
  $('torchIcon').className = 'torchIcon ' + s.torch;
  document.querySelectorAll('#guideTop .lights i').forEach(i => i.classList.toggle('active', i.classList.contains(s.torch)));

  const me = s.players.get(room!.sessionId);
  if (me) {
    $('hudStamina').textContent = me.stamina.toFixed(0);
    $('hudProg').style.width = `${(me.prog / CFG.MAP_LENGTH) * 100}%`;
    $('hudCp').textContent = me.cpZone ? ZONES[me.cpZone - 1].name : 'Vạch xuất phát';
    document.querySelectorAll<HTMLElement>('.cpTrack [data-z]').forEach(el => {
      const z = +el.dataset.z!;
      el.classList.toggle('on', me.cpZone >= z);
      el.classList.toggle('here', el.classList.contains('node') && me.zone === z);
    });
    $('hudZone').textContent = me.zone ? `✨ Đang trong ${ZONES[me.zone - 1].name}: ${zoneBonus(me.zone)}` : '';
    // Vào khu đã từng lưu checkpoint -> popup nhẹ; khu MỚI thì popup checkpoint do message 'checkpoint' của server lo
    if (me.zone !== lastZone) {
      if (me.zone && me.zone <= me.cpZone && !me.stunned) popup('zone', `✨ ${ZONES[me.zone - 1].name}`, zoneBonus(me.zone), 1800);
      else if (!me.zone && lastZone) toast('Đã rời khu · hết thưởng khu', 1500);
      lastZone = me.zone;
    }
    // Hết stamina mà còn câu -> tự bật khung câu hỏi
    if (s.phase === 'play' && me.stamina < 1 && !quizOpen && !outOfQ && !me.rank && !suppressAuto) {
      setQuizOpen(true);
      $('quiz').classList.remove('flash'); void $('quiz').offsetWidth; $('quiz').classList.add('flash');
    }
  }
  if (performance.now() - boardAt > 250) { // ⚠️ dựng lại DOM 4 lần/giây thôi, 20Hz sẽ giật
    boardAt = performance.now();
    const list = ranking(s);
    $('board').innerHTML = list.slice(0, 10).map(p =>
      `<li style="--c:${hex(p.color)}"><b>${esc(p.name)}</b><small>${p.rank ? '🏁 về đích' : p.prog.toFixed(0) + 'm'} · ${p.qDone} câu</small>`
      + `<div class="lb"><i style="width:${Math.min(100, (p.prog / CFG.MAP_LENGTH) * 100)}%"></i>${cpMarks.map(l => `<u style="left:${l}"></u>`).join('')}</div></li>`).join('');
    if (s.phase === 'lobby') {
      $('lobbyCount').textContent = String(list.length);
      const html = list.map(p => `<li style="--c:${hex(p.color)}">${esc(p.name)}</li>`).join('');
      if ($('lobbyList').innerHTML !== html) $('lobbyList').innerHTML = html; // chỉ dựng lại khi đổi, tránh animation pop chạy lại liên tục
    }
  }
}
const ranking = (s: any) => {
  const arr: any[] = []; s.players.forEach((p: any) => arr.push(p));
  return arr.sort((a, b) => (a.rank || 999) - (b.rank || 999) || b.prog - a.prog);
};
function renderEnd(s: any) {
  $('endList').innerHTML = ranking(s).map((p, i) =>
    `<tr><td>${i + 1}</td><td><span class="sw" style="background:${hex(p.color)}"></span>${esc(p.name)}</td><td>${p.rank ? `🏁 về đích (hạng ${p.rank})` : p.prog.toFixed(1) + ' m'}</td><td>${p.qRight}/${p.qDone}</td><td>${p.caught}</td></tr>`).join('');
}

// Đồng hồ ván (giờ server) + thanh thưởng nhanh của câu hiện tại
setInterval(() => {
  const s = room?.state; if (!s || s.phase !== 'play') return;
  const left = Math.max(0, s.phaseEnd - serverNow()) / 1000;
  $('hudTimer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  const qLeftMs = qLocked ? 0 : Math.max(0, qEnds - serverNow()); // giờ server -> mọi máy đếm ngược khớp nhau
  $('qBar').style.width = `${(qLeftMs / CFG.QUESTION_MS) * 100}%`;
  $('qBar').classList.toggle('warn', qLeftMs > 0 && qLeftMs < 5000);
  $('qLeft').textContent = String(Math.ceil(qLeftMs / 1000));
}, 100);

// ================= INPUT + PREDICTION =================
const keys = new Set<string>();
const input = { x: 0, z: 0 };
const typing = () => document.activeElement instanceof HTMLInputElement;

addEventListener('keydown', e => {
  if (typing() || isHost) return;
  if (/^[1-4]$/.test(e.key) && quizOpen) answer(+e.key - 1);
  if (e.code === 'KeyQ' && room?.state.phase === 'play') setQuizOpen(!quizOpen);
  if (e.code === 'KeyH') $('guideTop').classList.toggle('collapsed'); // H ẩn khối luật, giữ lại phím
  keys.add(e.code); updateInput();
});
addEventListener('keyup', e => { keys.delete(e.code); updateInput(); });
// ⚠️ Alt-Tab khi đang giữ phím -> không nhận keyup -> nhân vật chạy mãi và bị bắt. Blur = thả hết phím.
addEventListener('blur', () => { keys.clear(); updateInput(); });

// keyIn = phím theo hướng camera (tiến/ngang); input = hướng THẾ GIỚI gửi server.
// Camera xoay theo hướng đường (nếu sau này làm đường cong) -> quy đổi lại liên tục, không chỉ lúc bấm phím.
const keyIn = { f: 0, r: 0 };
let lastSent = 0;
function updateInput() {
  keyIn.f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  keyIn.r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  syncInput(true);
}
function syncInput(force = false) {
  // phải của camera = (-dir.z, dir.x)
  const x = camDir.x * keyIn.f - camDir.z * keyIn.r, z = camDir.z * keyIn.f + camDir.x * keyIn.r;
  const changed = Math.abs(x - input.x) > 0.03 || Math.abs(z - input.z) > 0.03;
  input.x = x; input.z = z;
  const now = performance.now();
  // Gửi khi đổi phím, hoặc khi đang đi mà camera xoay (tối đa ~10 lần/giây cho nhẹ mạng)
  if (!isHost && (force || (changed && now - lastSent > 100))) { room?.send('input', input); lastSent = now; }
}

// Client prediction cho nhân vật của mình: bấm là chạy ngay, server vẫn là trọng tài.
const pred = new THREE.Vector3();
let predInit = false;
function reconcile(p: any) {
  const server = new THREE.Vector3(p.x, 0, p.z);
  if (!predInit || pred.distanceTo(server) > 2) { pred.copy(server); predInit = true; } // lệch nhiều (bị bắt, F5) -> nhảy về server
  else pred.lerp(server, 0.15); // lệch ít -> kéo nhẹ cho khớp
}

startLoop(dt => {
  // ⚠️ Mạng thật (Railway) có độ trễ: room có trước, state về sau -> s.players còn undefined. Thiếu guard này là vòng render chết hẳn.
  const s = room?.state; if (!s?.players || isHost) return;
  setFollow(room!.sessionId); // ⚠️ đặt lại mỗi frame: sau reconnect/F5 camera luôn bám đúng nhân vật của mình
  const me = s.players.get(room!.sessionId); if (!me) return;
  if (keyIn.f || keyIn.r) syncInput();
  const len = Math.hypot(input.x, input.z);
  if (s.phase === 'play' && len && !me.stunned && !me.rank && me.stamina > 0) {
    const speed = CFG.BASE_SPEED * (zoneAt(pred.x, pred.z) ? 1 + CFG.ZONE_SPEED_BONUS : 1);
    const r = clampToRoad(pred.x + (input.x / len) * speed * dt, pred.z + (input.z / len) * speed * dt); // cùng luật kẹp mép với server
    pred.x = r.x; pred.z = r.z;
  }
  const a = getAvatar(room!.sessionId); if (a) a.target.copy(pred);
});

// ================= BOOT =================
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __room: () => room, __avatar: (id: string) => getAvatar(id) }); // dùng cho test tự động
tryReconnect().then(role => { if (role) { if (role === 'host') { unlock(); resumeOnClick(); } enter(role === 'host'); } });
