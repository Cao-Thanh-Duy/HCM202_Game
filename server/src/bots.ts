// Load test: npm run bots -- <CODE> [số bot=30] [url=ws://localhost:2567]
// Bot tự trả lời câu (ngẫu nhiên, 1–5s/câu), chạy khi đuốc sáng, ~10% bot "liều" chạy cả khi đuốc tắt.
import { Client } from 'colyseus.js';
import { project, pointAt } from '../../shared/path';

const [code, n = '30', url = 'ws://localhost:2567'] = process.argv.slice(2);
if (!code) { console.log('Dùng: npm run bots -- <CODE> [n] [url]'); process.exit(1); }

let rtts: number[] = [];
async function bot(i: number) {
  const room = await new Client(url).joinById<any>(code, { name: `Bot ${i + 1}` });
  const reckless = Math.random() < 0.1;
  room.onMessage('pong', m => rtts.push(Date.now() - m.t));
  room.onMessage('q', q => { if (q) setTimeout(() => room.send('answer', Math.floor(Math.random() * q.options.length)), 1000 + Math.random() * 4000); });
  room.onMessage('*', () => {});
  setInterval(() => room.send('ping', { t: Date.now() }), 1000);
  setInterval(() => {
    const s = room.state;
    const go = s.phase === 'play' && (s.torch === 'on' || reckless);
    const me = s.players?.get(room.sessionId);
    let dir = { x: 0, z: 0 };
    if (go && me) { // đi theo đường: hướng tới điểm phía trước 4m
      const a = pointAt(project(me.x, me.z).s + 4);
      const dx = a.x - me.x, dz = a.z - me.z, l = Math.hypot(dx, dz) || 1;
      dir = { x: dx / l, z: dz / l };
    }
    room.send('input', dir);
  }, 100);
}

(async () => {
  for (let i = 0; i < +n; i++) { await bot(i); await new Promise(r => setTimeout(r, 50)); }
  console.log(`✅ ${n} bot đã vào phòng ${code}`);
  setInterval(() => {
    if (!rtts.length) return;
    const sorted = rtts.sort((a, b) => a - b);
    console.log(`RTT ms  avg=${(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)}  p95=${sorted[Math.floor(sorted.length * 0.95)]}`);
    rtts = [];
  }, 5000);
})();
