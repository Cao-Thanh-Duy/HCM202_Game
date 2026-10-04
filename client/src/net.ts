import { Client, Room } from 'colyseus.js';

// Dev: server riêng :2567. Production: server phục vụ luôn client -> cùng origin.
// Đổi server dự phòng (Render/Tunnel): build với VITE_SERVER_URL=wss://...
const URL = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `ws://${location.hostname}:2567` : location.origin.replace(/^http/, 'ws'));

export const client = new Client(URL);
export let room: Room<any> | null = null;
export let clockOffset = 0; // serverTime ≈ Date.now() + clockOffset
export const serverNow = () => Date.now() + clockOffset;

const KEY = 'torch-session';

function attach(r: Room<any>, role: 'host' | 'player') {
  room = r;
  // Lưu token để F5 / rớt mạng vẫn vào lại đúng nhân vật
  sessionStorage.setItem(KEY, JSON.stringify({ token: r.reconnectionToken, role }));
  let rtt = 0;
  const samples: number[] = [];
  r.onMessage('pong', ({ t, s }: { t: number; s: number }) => {
    const now = Date.now();
    rtt = now - t;
    samples.push(s - (t + rtt / 2));
    if (samples.length > 10) samples.shift();
    // Lấy median để 1 gói lag không làm lệch đồng hồ
    clockOffset = [...samples].sort((a, b) => a - b)[samples.length >> 1];
  });
  const ping = () => r.send('ping', { t: Date.now(), rtt });
  ping();
  const iv = setInterval(ping, 1000);
  r.onLeave(() => clearInterval(iv));
  return r;
}

export const createRoom = async () => attach(await client.create('torch', { host: true }), 'host');
export const joinRoom = async (code: string, name: string) => attach(await client.joinById(code, { name }), 'player');

export async function tryReconnect(): Promise<'host' | 'player' | null> {
  const saved = sessionStorage.getItem(KEY);
  if (!saved) return null;
  const { token, role } = JSON.parse(saved);
  try { attach(await client.reconnect(token), role); return role; }
  catch { sessionStorage.removeItem(KEY); return null; }
}

export const forgetSession = () => sessionStorage.removeItem(KEY);
