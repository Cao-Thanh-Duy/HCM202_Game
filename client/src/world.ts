import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG, ZONES, TEAM_COLORS, Torch } from '../../shared/config';
import { PTS, pointAt, project, toWorld, BOUNDS } from '../../shared/path';

// Bảng màu "sơn mài": đen son, đỏ son, vàng kim, nâu đất
const PAL = { lacquer: 0x1a0f08, earth: 0x4a2e19, road: 0x7a5030, gold: 0xe8b04a, red: 0xa8261b, night: 0x1c2b4f };

const quality = /Mobi|Android/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('low') ? 'low' : 'high';

export const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1)); // ⚠️ dpr 2-3 trên màn retina rất tốn GPU
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.lacquer);
scene.fog = new THREE.FogExp2(PAL.lacquer, 0.009);
export const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 500);

const L = CFG.MAP_LENGTH, HW = CFG.ROAD_HALF_WIDTH;
const END = pointAt(L);
const yawOf = (tx: number, tz: number) => Math.atan2(tx, tz); // góc quay quanh trục Y để mặt +Z của vật nhìn theo hướng (tx, tz)
// Ngọn đuốc đặt sau vạch đích, nối dài theo hướng đường
const TORCH = { x: END.x + END.tx * 16, z: END.z + END.tz * 16 };
const CX = (BOUNDS.x0 + BOUNDS.x1) / 2, CZ = (BOUNDS.z0 + BOUNDS.z1) / 2;

// ---------- Ánh sáng ----------
// hemi + trăng: luôn có ánh sáng nền -> khi đuốc tắt người chơi vẫn thấy rõ nhân vật (chỉ chuyển tông xanh đêm)
const hemi = new THREE.HemisphereLight(0xffd9a0, PAL.earth, 1.1);
const moon = new THREE.DirectionalLight(0x8fb0ff, 0.6);
moon.position.set(CX, 60, CZ - 40);
const torchDir = new THREE.DirectionalLight(0xffa64d, 2.5);
torchDir.position.set(TORCH.x, 40, TORCH.z);
torchDir.target.position.set(CX, 0, CZ);
const torchPoint = new THREE.PointLight(0xff8a2a, 900, 90, 1.5);
torchPoint.position.set(TORCH.x, 22, TORCH.z);
scene.add(hemi, moon, torchDir, torchDir.target, torchPoint);

// ---------- Helpers ----------
// Nhãn 3D kiểu sticker (cùng ngôn ngữ UI): nền phẳng + viền mực dày + bóng cứng lệch
const INK = '#2a1a12';
export function textSprite(text: string, bg = '#fffaf0', size = 48, fg = INK) {
  const c = document.createElement('canvas'), g = c.getContext('2d')!;
  const font = `800 ${size}px "Baloo 2", sans-serif`, pad = 22, lw = Math.max(3, size / 12), sh = Math.max(4, size / 9);
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = Math.ceil(size * 1.35);
  c.width = w + sh + lw; c.height = h + sh + lw;
  g.font = font; // ⚠️ đổi kích thước canvas sẽ reset font -> set lại
  const r = h / 2, x = lw / 2, y = lw / 2;
  g.fillStyle = INK; g.beginPath(); g.roundRect(x + sh, y + sh, w, h, r); g.fill();          // bóng cứng
  g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();                     // nền
  g.lineWidth = lw; g.strokeStyle = INK; g.stroke();                                          // viền mực
  g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, x + w / 2, y + h / 2 + size * 0.06);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // color 0.85: giữ dưới ngưỡng bloom, nếu không nền kem bị nhòe sáng
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false, color: 0xd9d9d9 }));
  s.scale.set(c.width / c.height, 1, 1);
  return s;
}
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,220,140,1)'); grd.addColorStop(0.3, 'rgba(255,140,40,0.6)'); grd.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const box = (w: number, h: number, d: number, color: number, emissive = 0) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.8 }));

// ---------- Map: đường chữ S ----------
// Dải (ribbon) bám theo đường từ quãng s0->s1, lệch ngang d0->d1 -> dùng cho mặt đường, thảm khu, vạch kẻ
function ribbon(s0: number, s1: number, d0: number, d1: number, y: number, step = 1) {
  const pos: number[] = [], idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, a = toWorld(s, d0), b = toWorld(s, d1);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    if (i < n) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0 + 140, BOUNDS.z1 - BOUNDS.z0 + 140), new THREE.MeshStandardMaterial({ color: PAL.earth, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CX, 0, CZ);
const road = new THREE.Mesh(ribbon(-3, L + 6, -HW, HW, 0.01), new THREE.MeshStandardMaterial({ color: PAL.road, roughness: 1, side: THREE.DoubleSide }));
// Vạch mép đường vàng nhạt cho dễ thấy lối khi đuốc tắt
const edgeMat = new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const edgeL = new THREE.Mesh(ribbon(0, L, -HW, -HW + 0.3, 0.02), edgeMat), edgeR = new THREE.Mesh(ribbon(0, L, HW - 0.3, HW, 0.02), edgeMat);
scene.add(ground, road, edgeL, edgeR);

// Vạch xuất phát
const startLine = new THREE.Mesh(ribbon(0, 0.8, -HW, HW, 0.03), new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
const st = toWorld(0, -HW - 2);
const startLbl = textSprite('XUẤT PHÁT', '#f6c445', 40); startLbl.position.set(st.x, 3, st.z); startLbl.scale.multiplyScalar(2.2);
scene.add(startLine, startLbl);

// 3 khu: thảm màu cong theo đường + biển "Khu N" + cờ CHECKPOINT
const zoneFx: { pad: THREE.Mesh; flag: THREE.Sprite }[] = [];
for (const z of ZONES) {
  const pad = new THREE.Mesh(ribbon(z.s0, z.s1, z.d0, z.d1, 0.04, 0.5),
    new THREE.MeshStandardMaterial({ color: z.color, emissive: z.color, emissiveIntensity: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  const hex = '#' + z.color.toString(16).padStart(6, '0');
  const at = toWorld(z.s1 - 2, (z.d0 + z.d1) / 2); // đặt biển ở cuối khu -> không che nhân vật đang đứng giữa khu
  const sign = textSprite(`${z.name} · +${z.bonus}⚡`, hex, 44); sign.position.set(at.x, 3.4, at.z); sign.scale.multiplyScalar(1.25);
  const flag = textSprite('⛳ CHECKPOINT', '#fffaf0', 34); flag.position.set(at.x, 2.2, at.z); flag.scale.multiplyScalar(0.75);
  scene.add(pad, sign, flag);
  zoneFx.push({ pad, flag });
}

// ---------- Hiệu ứng lưu checkpoint: vòng sóng lan + cột sáng + tia lửa bắn lên + khu nháy sáng ----------
interface Fx { t: number; dur: number; update: (k: number, dt: number) => void; dispose: () => void }
const fxs: Fx[] = [];
const sparkGeo = new THREE.BufferGeometry();
// follow: hiệu ứng bám theo nhân vật (người chơi vẫn đang di chuyển khi vừa bước vào khu)
export function checkpointFx(zone: number, follow: THREE.Object3D, mine: boolean) {
  const zf = zoneFx[zone - 1]; if (!zf) return;
  const gold = 0xf6c445;
  // 1. Vòng sóng lan trên mặt đất
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), new THREE.MeshBasicMaterial({ color: gold, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  // 2. Cột sáng bốc lên
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 10, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.translate(0, 5, 0);  // gốc cột ở mặt đất -> scale.y mọc từ dưới lên
  // 3. Tia lửa bắn tung
  const N = 40, pos = new Float32Array(N * 3), vel: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) { pos.set([0, 1, 0], i * 3); vel.push(new THREE.Vector3((Math.random() - .5) * 6, 6 + Math.random() * 6, (Math.random() - .5) * 6)); }
  const g = sparkGeo.clone(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd27a, size: 0.25, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const fx = new THREE.Group(); fx.add(ring, beam, sparks); fx.position.copy(follow.position); scene.add(fx);
  const padMat = zf.pad.material as THREE.MeshStandardMaterial;
  fxs.push({
    t: 0, dur: 1.6,
    update: (k, dt) => {
      fx.position.set(follow.position.x, 0, follow.position.z);
      ring.scale.setScalar(1 + k * 4); // ⚠️ không lan quá xa: camera đứng sau 8m, vòng to quá sẽ phủ kín màn hình
      (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) ** 2;
      beam.scale.set(1 - k * .6, 0.3 + k * 1.2, 1 - k * .6); (beam.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
      for (let i = 0; i < N; i++) { const v = vel[i]; v.y -= 12 * dt; pos[i * 3] += v.x * dt; pos[i * 3 + 1] = Math.max(0.1, pos[i * 3 + 1] + v.y * dt); pos[i * 3 + 2] += v.z * dt; }
      g.attributes.position.needsUpdate = true; (sparks.material as THREE.PointsMaterial).opacity = 1 - k;
      padMat.emissiveIntensity = 0.35 + 1.5 * Math.sin(k * Math.PI * 3) ** 2 * (1 - k); // khu nháy sáng 3 lần
      zf.flag.position.y = 2.2 + Math.abs(Math.sin(k * Math.PI * 4)) * (1 - k) * 1.2;   // cờ nảy
    },
    dispose: () => { scene.remove(fx); ring.geometry.dispose(); beam.geometry.dispose(); g.dispose(); padMat.emissiveIntensity = 0.35; },
  });
  // Cờ của chính mình đổi thành "ĐÃ LƯU" (chỉ trên máy người đó)
  if (mine) {
    const done = textSprite('✅ ĐÃ LƯU', '#7ccbb4', 34);
    done.position.copy(zf.flag.position); done.scale.copy(zf.flag.scale);
    scene.remove(zf.flag); scene.add(done); zf.flag = done;
  }
}
function updateFx(dt: number) {
  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i]; f.t += dt;
    const k = Math.min(1, f.t / f.dur); f.update(k, dt);
    if (k >= 1) { f.dispose(); fxs.splice(i, 1); }
  }
}

// Đèn lồng 2 bên mép đường mỗi 10m (InstancedMesh: 1 draw call cho tất cả)
const lanternN = (Math.floor(L / 10) + 1) * 2;
const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: PAL.red, emissive: 0xff3b1f, emissiveIntensity: 3 }), lanternN);
const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x2a1a10 }), lanternN);
const m4 = new THREE.Matrix4();
for (let i = 0; i < lanternN; i++) {
  const p = toWorld(Math.floor(i / 2) * 10, i % 2 ? HW + 1.5 : -HW - 1.5);
  lanterns.setMatrixAt(i, m4.makeTranslation(p.x, 3.2, p.z));
  posts.setMatrixAt(i, m4.makeTranslation(p.x, 1.5, p.z));
}
scene.add(lanterns, posts);

// Cây rải ngoài lòng đường (bỏ chỗ quá gần đường)
const treeN = 220;
const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 5, 6), new THREE.MeshStandardMaterial({ color: 0x2c4a26, flatShading: true }), treeN);
for (let i = 0, placed = 0; placed < treeN && i < treeN * 6; i++) {
  const x = BOUNDS.x0 - 40 + Math.random() * (BOUNDS.x1 - BOUNDS.x0 + 80), z = BOUNDS.z0 - 40 + Math.random() * (BOUNDS.z1 - BOUNDS.z0 + 80);
  const pr = project(x, z);
  if (Math.abs(pr.d) < HW + 5 && pr.s > -1 && pr.s < L + 20) continue;
  const sc = 0.7 + Math.random() * 0.8;
  crowns.setMatrixAt(placed++, m4.compose(new THREE.Vector3(x, 2.5 * sc, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)));
}
scene.add(crowns);

// Cổng đích (quay vuông góc với đường): 4 cột Cần – Kiệm – Liêm – Chính
const gate = new THREE.Group();
['CẦN', 'KIỆM', 'LIÊM', 'CHÍNH'].forEach((t, i) => {
  const x = -6.75 + i * 4.5; // trục X cục bộ của cổng = ngang đường
  const col = box(1.2, 8, 1.2, PAL.red, 0x400a05); col.position.set(x, 4, 0);
  const lbl = textSprite(t, '#f6c445', 56); lbl.position.set(x, 5, -0.8); lbl.scale.multiplyScalar(1.6);
  gate.add(col, lbl);
});
const beam = box(17, 1.2, 1.6, PAL.gold, 0x5a3a00); beam.position.y = 8.6; gate.add(beam);
const finishSign = textSprite('🏁 ĐÍCH', '#fffaf0', 60); finishSign.position.y = 10.5; finishSign.scale.multiplyScalar(2); gate.add(finishSign);
gate.position.set(END.x, 0, END.z); gate.rotation.y = yawOf(END.tx, END.tz);
const finishLine = new THREE.Mesh(ribbon(L - 0.8, L, -HW, HW, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
scene.add(gate, finishLine);

// ---------- CẠM BẪY (vị trí do server random, gửi qua state.traps) ----------
// 💣 Bom: quả cầu đen + ngòi + đèn đỏ nhấp nháy. 🚧 Hàng rào: cọc + 2 thanh sọc đỏ trắng chắn nửa đường.
const trapGroup = new THREE.Group(); scene.add(trapGroup);
const bombMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.3 });
const bombLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const bombs: { g: THREE.Group; x: number; z: number }[] = [];
const fenceMatA = new THREE.MeshStandardMaterial({ color: 0xe2574c, emissive: 0x5a0d08 }), fenceMatB = new THREE.MeshStandardMaterial({ color: 0xfff2dc, emissive: 0x3a3020 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e });
let trapsBuilt = 0;
export function buildTraps(list: { kind: string; s: number; d0: number; d1: number }[]) {
  if (list.length === trapsBuilt) return; // chỉ dựng 1 lần khi nhận đủ danh sách
  trapGroup.clear(); bombs.length = 0; trapsBuilt = list.length;
  for (const t of list) {
    if (t.kind === 'bomb') {
      const p = toWorld(t.s, t.d0), g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), bombMat); ball.position.y = 0.7;
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5), postMat); fuse.position.y = 1.55;
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bombLightMat); spark.position.y = 1.85;
      const warn = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.3, 28), new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      warn.rotation.x = -Math.PI / 2; warn.position.y = 0.05; // vòng đỏ dưới đất = bán kính nổ
      g.add(ball, fuse, spark, warn); g.position.set(p.x, 0, p.z);
      trapGroup.add(g); bombs.push({ g, x: p.x, z: p.z });
    } else {
      const g = new THREE.Group(), pt = pointAt(t.s), yaw = yawOf(pt.tx, pt.tz);
      const w = t.d1 - t.d0, mid = toWorld(t.s, (t.d0 + t.d1) / 2);
      for (let k = 0; k <= Math.ceil(w / 2); k++) { // cọc mỗi ~2m
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), postMat);
        c.position.set(-w / 2 + (w * k) / Math.ceil(w / 2), 0.8, 0); g.add(c);
      }
      [0.6, 1.2].forEach((y, j) => {
        const n = Math.ceil(w / 1.2);
        for (let k = 0; k < n; k++) { // thanh sọc đỏ/trắng xen kẽ
          const b = new THREE.Mesh(new THREE.BoxGeometry(w / n, 0.28, 0.15), (k + j) % 2 ? fenceMatA : fenceMatB);
          b.position.set(-w / 2 + (w / n) * (k + 0.5), y, 0); g.add(b);
        }
      });
      g.position.set(mid.x, 0, mid.z); g.rotation.y = yaw; // trục X cục bộ = ngang đường
      trapGroup.add(g);
    }
  }
}

// Nổ bom: quả cầu lửa phồng to + khói + mảnh văng
export function boomFx(i: number) {
  const b = trapGroup.children[i]; if (!b) return;
  const fire = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  fire.position.set(b.position.x, 1, b.position.z); scene.add(fire);
  const N = 50, pos = new Float32Array(N * 3), vel: THREE.Vector3[] = [];
  for (let k = 0; k < N; k++) { pos.set([b.position.x, 1, b.position.z], k * 3); vel.push(new THREE.Vector3((Math.random() - .5) * 14, 4 + Math.random() * 8, (Math.random() - .5) * 14)); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const debris = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff6a2a, size: 0.35, transparent: true, depthWrite: false }));
  scene.add(debris);
  fxs.push({
    t: 0, dur: 1.1,
    update: (k, dt) => {
      fire.scale.setScalar(1 + k * 5); (fire.material as THREE.MeshBasicMaterial).opacity = (1 - k) ** 1.5;
      (fire.material as THREE.MeshBasicMaterial).color.setHSL(0.08 * (1 - k), 1, 0.55 - 0.3 * k);
      for (let q = 0; q < N; q++) { const v = vel[q]; v.y -= 18 * dt; pos[q * 3] += v.x * dt; pos[q * 3 + 1] = Math.max(0.05, pos[q * 3 + 1] + v.y * dt); pos[q * 3 + 2] += v.z * dt; }
      g.attributes.position.needsUpdate = true; (debris.material as THREE.PointsMaterial).opacity = 1 - k;
    },
    dispose: () => { scene.remove(fire, debris); fire.geometry.dispose(); g.dispose(); },
  });
}
// Đâm hàng rào: rung lắc hàng rào
export function fenceFx(i: number) {
  const f = trapGroup.children[i]; if (!f) return;
  const baseYaw = f.rotation.y;
  fxs.push({ t: 0, dur: 0.6, update: k => (f.rotation.y = baseYaw + Math.sin(k * Math.PI * 8) * 0.12 * (1 - k)), dispose: () => (f.rotation.y = baseYaw) });
}

// ---------- NGỌN ĐUỐC (boss) — to, cao, có quầng sáng + cột sáng + tàn lửa để nhìn từ xa vẫn nhận ra ----------
const torch = new THREE.Group();
const base = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.2, 2, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a1e }));
base.position.y = 1;
const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, 16, 10), new THREE.MeshStandardMaterial({ color: 0x6b4423, emissive: 0x2a1004 }));
pole.position.y = 10;
const ringMat = new THREE.MeshStandardMaterial({ color: PAL.gold, metalness: 0.7, roughness: 0.3, emissive: 0x6a4000 });
[6, 12].forEach(y => { const r = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.25, 8, 20), ringMat); r.rotation.x = Math.PI / 2; r.position.y = y; torch.add(r); });
const bowl = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 1.6, 2.4, 16), ringMat);
bowl.position.y = 19;
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
const flame = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 14), flameMat);
flame.position.y = 24;
const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
const core = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5, 12), coreMat);
core.position.y = 23;
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
halo.position.y = 24; halo.scale.set(26, 26, 1);
const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.5, 80, 16, 1, true), pillarMat); // cột sáng lên trời
pillar.position.y = 60;
const torchLbl = textSprite('🔥 NGỌN ĐUỐC', '#e2574c', 52, '#fff8ec');
torchLbl.position.y = 33; torchLbl.scale.multiplyScalar(3);
torch.add(base, pole, bowl, flame, core, halo, pillar, torchLbl);

// Tàn lửa bay lên (Points: 1 draw call)
const EMBERS = 80;
const emberGeo = new THREE.BufferGeometry();
const emberPos = new Float32Array(EMBERS * 3);
for (let i = 0; i < EMBERS; i++) emberPos.set([(Math.random() - 0.5) * 5, 22 + Math.random() * 14, (Math.random() - 0.5) * 5], i * 3);
emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
const emberMat = new THREE.PointsMaterial({ color: 0xffb050, size: 0.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
torch.add(new THREE.Points(emberGeo, emberMat));
torch.position.set(TORCH.x, 0, TORCH.z);
scene.add(torch);

// ---------- Post-processing (chỉ preset high) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.5, 0.85);
if (quality === 'high') composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Players ----------
interface Avatar { g: THREE.Group; target: THREE.Vector3; rot: number }
const avatars = new Map<string, Avatar>();
const bodyGeo = new THREE.CapsuleGeometry(0.5, 0.8, 4, 8);
const hatGeo = new THREE.ConeGeometry(0.9, 0.5, 16); // nón lá
const hatMat = new THREE.MeshStandardMaterial({ color: 0xd9c08a, emissive: 0x3a2a10 });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });

export function upsertAvatar(id: string, name: string, color: number, isMe: boolean) {
  if (avatars.has(id)) return avatars.get(id)!;
  const g = new THREE.Group();
  const c = TEAM_COLORS[color];
  // emissive nhẹ theo màu đội -> lúc đuốc tắt vẫn nhận ra ai là ai
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, roughness: 0.6 }));
  body.position.y = 0.9;
  const hat = new THREE.Mesh(hatGeo, hatMat); hat.position.y = 2.1;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), shadowMat); // blob shadow thay cho shadow map
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
  const tag = textSprite(name, isMe ? '#f6c445' : '#fffaf0', 40); tag.position.y = 2.9; tag.scale.multiplyScalar(0.5);
  g.add(body, hat, shadow, tag);
  if (isMe) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 24), new THREE.MeshBasicMaterial({ color: PAL.gold }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  }
  scene.add(g);
  const a = { g, target: new THREE.Vector3(), rot: 0 };
  avatars.set(id, a);
  return a;
}
export const getAvatar = (id: string) => avatars.get(id);

// ---------- Torch light state ----------
let light = 1; // 1 = sáng, 0 = tắt
let torchState: Torch = 'on';
export const setTorch = (t: Torch) => (torchState = t);
const cWarm = new THREE.Color(0xffd9a0), cCool = new THREE.Color(0x8aa6e0);
const cBgDay = new THREE.Color(PAL.lacquer), cBgNight = new THREE.Color(PAL.night);

function updateTorch(dt: number, t: number) {
  // dim: giảm TUYẾN TÍNH trong đúng TORCH_DIM_MS để người chơi đọc được nhịp; on: bật lại nhanh
  if (torchState === 'on') light = Math.min(1, light + dt / 0.3);
  else if (torchState === 'dim') light = Math.max(0.15, light - dt / (CFG.TORCH_DIM_MS / 1000));
  else light = Math.max(0, light - dt / 0.15);

  const flicker = torchState === 'dim' ? 0.7 + Math.random() * 0.6 : 0.93 + Math.sin(t * 9) * 0.05 + Math.random() * 0.04;
  const k = light * flicker;
  flame.scale.set(0.25 + 0.75 * k, 0.15 + 0.85 * k, 0.25 + 0.75 * k);
  core.scale.copy(flame.scale);
  flameMat.color.setHSL(0.08 * light + 0.6 * (1 - light), 1, 0.55).multiplyScalar(2.5); // >1 để bloom bắt; cam -> xanh khi tắt
  coreMat.color.setScalar(0.4 + 1.6 * k);
  halo.material.opacity = 0.15 + 0.85 * k;
  halo.scale.setScalar(10 + 18 * k);
  pillarMat.opacity = 0.03 + 0.12 * k;
  emberMat.opacity = k;
  torchDir.intensity = 2.5 * k;
  torchPoint.intensity = 900 * k;

  // ⚠️ Không cho tối hẳn: hemi tối thiểu 0.55 + trăng -> nhân vật vẫn rõ, chỉ đổi sang tông xanh
  hemi.intensity = 0.55 + 0.55 * light;
  hemi.color.lerpColors(cCool, cWarm, light);
  moon.intensity = 0.9 - 0.4 * light;
  (scene.fog as THREE.FogExp2).color.lerpColors(cBgNight, cBgDay, light);
  (scene.background as THREE.Color).copy((scene.fog as THREE.FogExp2).color);
  bloom.strength = 0.5 + 0.8 * light;

  // Tàn lửa bay lên, quá cao thì quay về miệng đuốc
  for (let i = 0; i < EMBERS; i++) {
    const y = i * 3 + 1;
    emberPos[y] += dt * (2 + (i % 5));
    if (emberPos[y] > 40) emberPos[y] = 22;
  }
  emberGeo.attributes.position.needsUpdate = true;
  bombLightMat.color.setRGB(Math.sin(t * 8) > 0 ? 2.5 : 0.4, 0.15, 0.1); // đèn bom nhấp nháy
}

// ---------- Camera ----------
let followId: string | null = null; // null = camera host
export const setFollow = (id: string | null) => (followId = id);
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
void PTS;

// Camera host: 'fit' = tự co giãn để thấy MỌI người chơi, 'map' = toàn bản đồ. Cuộn chuột zoom, kéo chuột trái để dời.
export const hostCam = { mode: 'fit' as 'fit' | 'map', zoom: 1, panX: 0, panZ: 0 };
export function bindHostControls() {
  const el = renderer.domElement;
  el.addEventListener('wheel', e => { e.preventDefault(); hostCam.zoom = THREE.MathUtils.clamp(hostCam.zoom * (e.deltaY > 0 ? 1.12 : 0.89), 0.35, 2.2); }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', e => (drag = { x: e.clientX, y: e.clientY }));
  addEventListener('pointerup', () => (drag = null));
  addEventListener('pointermove', e => {
    if (!drag) return;
    const s = 0.12 * hostCam.zoom; // kéo xa hơn khi đang zoom ra
    hostCam.panX -= (e.clientX - drag.x) * s; hostCam.panZ -= (e.clientY - drag.y) * s;
    drag = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener('dblclick', () => Object.assign(hostCam, { zoom: 1, panX: 0, panZ: 0 }));
}

// Hướng camera người chơi = hướng đường tại chỗ nhân vật (làm mượt) -> client dùng để đổi WASD sang hướng thế giới
export const camDir = { x: 1, z: 0 };
function updateCamera(dt: number) {
  const a = followId ? avatars.get(followId) : null;
  if (a) {
    // Góc nhìn thứ 3 bám theo hướng đường chữ S: ngay sau lưng, thấp và gần
    const p = a.g.position, ahead = pointAt(project(p.x, p.z).s + 6); // nhìn trước 6m -> vào cua camera xoay sớm, đỡ chóng mặt
    let fx = ahead.x - p.x, fz = ahead.z - p.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const kd = 1 - Math.exp(-dt * 3);
    camDir.x += (fx - camDir.x) * kd; camDir.z += (fz - camDir.z) * kd;
    const cl = Math.hypot(camDir.x, camDir.z) || 1; camDir.x /= cl; camDir.z /= cl;
    camPos.set(p.x - camDir.x * 8.5, 5, p.z - camDir.z * 8.5);
    camLook.set(p.x + camDir.x * 12, 1.4, p.z + camDir.z * 12);
  } else {
    let cx = CX, cz = CZ, span = Math.max(BOUNDS.x1 - BOUNDS.x0, (BOUNDS.z1 - BOUNDS.z0) * 1.8) + 40;
    if (hostCam.mode === 'fit' && avatars.size) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      avatars.forEach(v => { const q = v.g.position; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); });
      cx = (x0 + x1) / 2; cz = (z0 + z1) / 2;
      span = Math.max(x1 - x0 + 24, (z1 - z0) * 1.8 + 20, 34); // tối thiểu 34m cho khỏi zoom sát quá
    }
    const d = span * 0.55 * hostCam.zoom;
    cx += hostCam.panX; cz += hostCam.panZ;
    camPos.set(cx, d * 1.15, cz + d);
    camLook.set(cx, 0, cz - 4);
  }
  // Xa quá (vừa vào ván / F5 / bị đưa về checkpoint) -> nhảy thẳng tới, không bay lượn từ xa
  const k = camera.position.distanceTo(camPos) > 40 ? 1 : 1 - Math.exp(-dt * 4);
  camera.position.lerp(camPos, k);
  camera.userData.look = (camera.userData.look ?? camLook.clone()).lerp(camLook, k);
  camera.lookAt(camera.userData.look);
}

// ---------- Loop ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const clock = new THREE.Clock();
export function startLoop(onFrame: (dt: number) => void) {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    // ⚠️ Lỗi trong callback mà không bắt thì three.js dừng hẳn requestAnimationFrame -> màn hình đứng hình vĩnh viễn
    try { onFrame(dt); } catch (e) { console.error('[frame]', e); }
    // Nội suy tới vị trí server -> mượt dù server chỉ gửi 20Hz
    const k = 1 - Math.exp(-dt * 14);
    avatars.forEach(a => {
      a.g.position.lerp(a.target, k);
      const d = Math.atan2(Math.sin(a.rot - a.g.rotation.y), Math.cos(a.rot - a.g.rotation.y)); // quay theo góc ngắn nhất
      a.g.rotation.y += d * k;
    });
    updateTorch(dt, t);
    updateFx(dt);
    updateCamera(dt);
    composer.render();
  });
}
