// Âm thanh — CHỈ bật ở máy host / máy chiếu.
// Nhạc nền: file mp3 trong client/public/sound (lobby.mp3, ingame.mp3). Hiệu ứng: tổng hợp bằng WebAudio.
// ⚠️ Trình duyệt chặn audio cho tới khi người dùng click -> gọi unlock() trong sự kiện click "Tạo phòng".
let ctx: AudioContext | null = null;
let master: GainNode;
let fireGain: GainNode | null = null;
let sfxBus: GainNode;
// Âm lượng do host chỉnh (0..1), lưu localStorage để F5 không mất
const load = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };
const save = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* chế độ ẩn danh */ } };
export const vol = { music: load('vol-music', 0.6), sfx: load('vol-sfx', 0.8) };
let duckLevel = 1;
export let muted = false;

export function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);
  }
  ctx.resume();
}
// ---------- Nhạc nền: phát qua WebAudio để tắt tiếng / giảm âm lượng chung 1 chỗ ----------
let musicBus: GainNode | null = null;
const tracks: Record<string, { el: HTMLAudioElement; gain: GainNode }> = {};
let current: string | null = null;

function track(name: string) {
  if (tracks[name]) return tracks[name];
  const el = new Audio(`/sound/${name}.mp3`); el.loop = true; el.preload = 'auto';
  if (!musicBus) { musicBus = ctx!.createGain(); musicBus.gain.value = vol.music * 0.7; /* x0.7: nhạc luôn nhỏ hơn hiệu ứng */ musicBus.connect(master); }
  const gain = ctx!.createGain(); gain.gain.value = 0;
  ctx!.createMediaElementSource(el).connect(gain).connect(musicBus); // ⚠️ mỗi <audio> chỉ tạo source 1 lần
  return (tracks[name] = { el, gain });
}

// Chuyển bài có crossfade 1.2s. null = tắt nhạc.
export function music(name: 'lobby' | 'ingame' | null) {
  if (!ctx || name === current) return;
  const t = ctx.currentTime;
  const prev = current;
  if (prev) {
    tracks[prev].gain.gain.setTargetAtTime(0, t, 0.4);
    setTimeout(() => { if (current !== prev) tracks[prev].el.pause(); }, 1500); // fade xong mới dừng, trừ khi đã quay lại bài cũ
  }
  current = name;
  if (!name) return;
  const tr = track(name);
  tr.el.currentTime = 0;
  tr.el.play().catch(() => {}); // bị chặn autoplay thì thôi, lần click kế tiếp sẽ resume (xem resumeOnClick)
  tr.gain.gain.setTargetAtTime(1, t, 0.4);
}
// Đuốc tắt -> nhạc nhỏ lại cho căng thẳng, đuốc sáng -> to lại
export function duck(level: number) { duckLevel = level; musicBus?.gain.setTargetAtTime(vol.music * 0.7 * level, ctx!.currentTime, 0.25); }
export function setVolume(kind: 'music' | 'sfx', v: number) {
  vol[kind] = v; save('vol-' + kind, v);
  if (!ctx) return;
  if (kind === 'sfx') sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  else musicBus?.gain.setTargetAtTime(v * 0.7 * duckLevel, ctx.currentTime, 0.05);
}

// F5 trang host: chưa có click nên trình duyệt chặn âm thanh -> click bất kỳ đâu một lần để bật lại
export function resumeOnClick() {
  addEventListener('pointerdown', () => { unlock(); if (current) tracks[current]?.el.play().catch(() => {}); }, { once: true });
}

export function toggleMute() { muted = !muted; if (ctx) master.gain.value = muted ? 0 : 1; return muted; }

const noiseBuf = () => {
  const b = ctx!.createBuffer(1, ctx!.sampleRate * 2, ctx!.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
};

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, at = 0, slideTo?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dur);
}

function noise(dur: number, freq: number, vol = 0.3, q = 1) {
  if (!ctx) return;
  const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(sfxBus); src.start(t); src.stop(t + dur);
}

// Tiếng lửa cháy liên tục, to/nhỏ theo trạng thái đuốc
function startFire() {
  if (!ctx || fireGain) return;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
  src.buffer = noiseBuf(); src.loop = true;
  f.type = 'lowpass'; f.frequency.value = 900;
  fireGain = ctx.createGain(); fireGain.gain.value = 0;
  src.connect(f).connect(fireGain).connect(sfxBus); src.start();
}

export const sfx = {
  torchOn() { startFire(); noise(0.6, 600, 0.5, 0.7); tone(220, 0.5, 'triangle', 0.15, 0, 440); fireGain?.gain.setTargetAtTime(0.18, ctx!.currentTime, 0.1); },
  torchDim() { for (let i = 0; i < 4; i++) tone(880, 0.12, 'square', 0.12, i * 0.25); fireGain?.gain.setTargetAtTime(0.05, ctx!.currentTime, 0.3); },
  torchOff() { tone(110, 1.2, 'sine', 0.5, 0, 55); noise(0.4, 200, 0.4); fireGain?.gain.setTargetAtTime(0, ctx!.currentTime, 0.05); },
  caught() { tone(300, 0.35, 'sawtooth', 0.25, 0, 90); },
  checkpoint() { tone(660, 0.15, 'triangle', 0.2); tone(990, 0.25, 'triangle', 0.2, 0.12); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, 'triangle', 0.25, i * 0.12)); },
  start() { [392, 523, 659].forEach((f, i) => tone(f, 0.5, 'triangle', 0.25, i * 0.15)); },
  end() { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.5, 'triangle', 0.25, i * 0.18)); fireGain?.gain.setTargetAtTime(0, ctx!.currentTime, 0.2); },
  join() { tone(880, 0.1, 'sine', 0.15); },
};
