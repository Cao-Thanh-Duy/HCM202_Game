import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG, ZONES, TEAM_COLORS, Torch } from '../../shared/config';

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

const L = CFG.MAP_LENGTH, W = CFG.MAP_HALF_WIDTH;
const TORCH_X = L + 14;

// ---------- Ánh sáng ----------
// hemi + trăng: luôn có ánh sáng nền -> khi đuốc tắt người chơi vẫn thấy rõ nhân vật (chỉ chuyển tông xanh đêm)
const hemi = new THREE.HemisphereLight(0xffd9a0, PAL.earth, 1.1);
const moon = new THREE.DirectionalLight(0x8fb0ff, 0.6);
moon.position.set(L / 2, 60, -40);
const torchDir = new THREE.DirectionalLight(0xffa64d, 2.5);
torchDir.position.set(TORCH_X + 10, 40, 0);
torchDir.target.position.set(L / 2, 0, 0);
const torchPoint = new THREE.PointLight(0xff8a2a, 900, 90, 1.5);
torchPoint.position.set(TORCH_X, 22, 0);
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

// ---------- Map ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(L + 100, W * 2 + 70), new THREE.MeshStandardMaterial({ color: PAL.earth, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.x = L / 2;
const road = new THREE.Mesh(new THREE.PlaneGeometry(L + 20, 6), new THREE.MeshStandardMaterial({ color: PAL.road, roughness: 1 }));
road.rotation.x = -Math.PI / 2; road.position.set(L / 2 + 5, 0.01, 0);
scene.add(ground, road);

// Vạch xuất phát
const startLine = new THREE.Mesh(new THREE.PlaneGeometry(0.8, W * 2), new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.8 }));
startLine.rotation.x = -Math.PI / 2; startLine.position.set(0, 0.02, 0);
const startLbl = textSprite('XUẤT PHÁT', '#f6c445', 40); startLbl.position.set(0, 3, -W - 2); startLbl.scale.multiplyScalar(2.2);
scene.add(startLine, startLbl);

// 3 khu: thảm màu + viền + biển tên + cờ CHECKPOINT
const zoneFx: { pad: THREE.Mesh; flag: THREE.Sprite; cx: number; cz: number }[] = [];
for (const z of ZONES) {
  const w = z.x1 - z.x0, d = z.z1 - z.z0, cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: z.color, emissive: z.color, emissiveIntensity: 0.35, transparent: true, opacity: 0.5 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.03, cz);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.3, d)), new THREE.LineBasicMaterial({ color: z.color }));
  edge.position.set(cx, 0.15, cz);
  // Biển tên + cờ nhỏ, đặt ở mép xa của khu -> không che nhân vật đứng giữa khu
  const sign = textSprite(z.name, '#' + z.color.toString(16).padStart(6, '0'), 44);
  sign.position.set(z.x1 - 2, 3.4, cz); sign.scale.multiplyScalar(1.25);
  const flag = textSprite('⛳ CHECKPOINT', '#fffaf0', 34);
  flag.position.set(z.x1 - 2, 2.2, cz); flag.scale.multiplyScalar(0.75);
  scene.add(pad, edge, sign, flag);
  zoneFx.push({ pad, flag, cx, cz });
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
      ring.scale.setScalar(1 + k * 4); // ⚠️ không lan quá xa: camera đứng sau 11m, vòng to quá sẽ phủ kín màn hình (ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) ** 2;
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

// Đèn lồng 2 bên đường (InstancedMesh: 1 draw call cho tất cả)
const lanternN = Math.floor(L / 10) * 2 + 2;
const lanterns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: PAL.red, emissive: 0xff3b1f, emissiveIntensity: 3 }), lanternN);
const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x2a1a10 }), lanternN);
const m4 = new THREE.Matrix4();
for (let i = 0; i < lanternN; i++) {
  const x = Math.floor(i / 2) * 10, z = i % 2 ? W + 1.5 : -W - 1.5;
  lanterns.setMatrixAt(i, m4.makeTranslation(x, 3.2, z));
  posts.setMatrixAt(i, m4.makeTranslation(x, 1.5, z));
}
scene.add(lanterns, posts);

// Cây rải ngoài biên
const treeN = 140;
const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 5, 6), new THREE.MeshStandardMaterial({ color: 0x2c4a26, flatShading: true }), treeN);
for (let i = 0; i < treeN; i++) {
  const x = Math.random() * (L + 60) - 20, side = Math.random() < 0.5 ? -1 : 1;
  const z = side * (W + 6 + Math.random() * 20), s = 0.7 + Math.random() * 0.8;
  crowns.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 2.5 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
}
scene.add(crowns);

// Cổng đích: 4 cột Cần – Kiệm – Liêm – Chính
const gate = new THREE.Group();
['CẦN', 'KIỆM', 'LIÊM', 'CHÍNH'].forEach((t, i) => {
  const z = -9 + i * 6;
  const col = box(1.2, 8, 1.2, PAL.red, 0x400a05); col.position.set(0, 4, z);
  const lbl = textSprite(t, '#f6c445', 56); lbl.position.set(-0.8, 5, z); lbl.scale.multiplyScalar(1.6);
  gate.add(col, lbl);
});
const beam = box(1.6, 1.2, 22, PAL.gold, 0x5a3a00); beam.position.y = 8.6; gate.add(beam);
const finishSign = textSprite('🏁 ĐÍCH', '#fffaf0', 60); finishSign.position.y = 10.5; finishSign.scale.multiplyScalar(2); gate.add(finishSign);
gate.position.x = L; scene.add(gate);

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
torch.position.set(TORCH_X, 0, 0);
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
}

// ---------- Camera ----------
let followId: string | null = null; // null = camera host
export const setFollow = (id: string | null) => (followId = id);
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

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

function updateCamera(dt: number) {
  const a = followId ? avatars.get(followId) : null;
  if (a) {
    // Góc nhìn thứ 3: ngay sau lưng, thấp và gần -> thấy rõ nhân vật + ngọn đuốc phía trước
    const p = a.g.position;
    camPos.set(p.x - 8.5, 5, p.z);
    camLook.set(p.x + 12, 1.4, p.z);
  } else {
    let cx = L / 2 + 10, cz = 0, span = L + 30;
    if (hostCam.mode === 'fit' && avatars.size) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      avatars.forEach(v => { const q = v.g.position; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); });
      cx = (x0 + x1) / 2 + 4; cz = (z0 + z1) / 2;
      span = Math.max(x1 - x0 + 24, (z1 - z0) * 2.2 + 16, 34); // tối thiểu 40m cho khỏi zoom sát quá
    }
    const d = span * 0.55 * hostCam.zoom;
    cx += hostCam.panX; cz += hostCam.panZ;
    camPos.set(cx, d * 1.15, cz + d);
    camLook.set(cx, 0, cz - 4);
  }
  // Xa quá (vừa vào ván / F5 / bị bắt về checkpoint) -> nhảy thẳng tới, không bay lượn từ xa
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
