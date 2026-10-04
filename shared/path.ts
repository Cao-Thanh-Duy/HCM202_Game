// Đường đi hình chữ S (dùng chung server + client).
// Mọi luật theo vị trí (khu, bẫy, về đích, chặn mép) đều quy về toạ độ đường (s, d):
//   s = quãng đường dọc tim đường (0 = xuất phát, MAP_LENGTH = đích), d = lệch ngang (+ phải, - trái).
import { CFG, ZONES } from './config';

const N = 400; // số đoạn lấy mẫu; 400 đủ mượt, project() duyệt hết vẫn rẻ (40 người x 20Hz)
export interface PathPt { x: number; z: number; s: number }
export const PTS: PathPt[] = [];
(() => {
  // 1 chu kỳ sin = chữ S nằm ngang (2 khúc cua). Bán kính cua nhỏ nhất ~19m > nửa bề rộng đường -> không bị chồng lấn
  const raw = Array.from({ length: N + 1 }, (_, i) => ({ x: 150 * (i / N), z: 32 * Math.sin(2 * Math.PI * (i / N)) }));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
  const k = CFG.MAP_LENGTH / cum[N]; // co giãn đều cho đúng chiều dài yêu cầu
  raw.forEach((p, i) => PTS.push({ x: p.x * k, z: p.z * k, s: cum[i] * k }));
})();

// Điểm trên tim đường tại quãng s + vector tiếp tuyến (t) và pháp tuyến bên phải (n)
export function pointAt(s: number) {
  s = Math.max(0, Math.min(CFG.MAP_LENGTH, s));
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PTS[m].s <= s) lo = m; else hi = m; } // tìm nhị phân
  const a = PTS[lo], b = PTS[hi], len = b.s - a.s || 1, u = (s - a.s) / len;
  const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tx, tz, nx: -tz, nz: tx };
}

// Chiếu 1 điểm thế giới lên đường -> (s, d)
export function project(x: number, z: number) {
  let best = Infinity, bs = 0, bd = 0;
  for (let i = 0; i < N; i++) {
    const a = PTS[i], b = PTS[i + 1], ex = b.x - a.x, ez = b.z - a.z, len2 = ex * ex + ez * ez;
    const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    const cx = a.x + ex * u, cz = a.z + ez * u, d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 < best) {
      best = d2; const len = Math.sqrt(len2);
      bs = a.s + u * len;
      bd = ((x - cx) * -ez + (z - cz) * ex) / len; // chiếu lên pháp tuyến phải (-ez, ex)
    }
  }
  return { s: bs, d: bd };
}

// Toạ độ đường -> thế giới
export function toWorld(s: number, d: number) {
  const p = pointAt(s);
  return { x: p.x + p.nx * d, z: p.z + p.nz * d };
}

// Giữ người chơi trong lòng đường: kẹp s vào [0, L], d vào [-HW, HW]
export function clampToRoad(x: number, z: number) {
  const { s, d } = project(x, z);
  const HW = CFG.ROAD_HALF_WIDTH;
  if (Math.abs(d) <= HW && s > 0 && s < CFG.MAP_LENGTH) return { x, z, s, d };
  const cs = Math.max(0, Math.min(CFG.MAP_LENGTH, s)), cd = Math.max(-HW, Math.min(HW, d));
  return { ...toWorld(cs, cd), s: cs, d: cd };
}

export const zoneAtSD = (s: number, d: number) => ZONES.find(k => s >= k.s0 && s <= k.s1 && d >= k.d0 && d <= k.d1)?.id ?? 0;
export const zoneAt = (x: number, z: number) => { const p = project(x, z); return zoneAtSD(p.s, p.d); };

// Điểm hồi sinh: giữa khu đã vào gần nhất; chưa vào khu nào -> vạch xuất phát
export function respawnOf(cpZone: number) {
  const k = ZONES[cpZone - 1];
  return k ? toWorld((k.s0 + k.s1) / 2, (k.d0 + k.d1) / 2) : toWorld(0.5, 0);
}

// Hộp bao toàn bộ đường (camera host chế độ "toàn bản đồ")
export const BOUNDS = PTS.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }),
  { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
