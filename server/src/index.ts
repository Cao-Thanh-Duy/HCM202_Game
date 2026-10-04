import express from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { TorchRoom } from './TorchRoom';

// ⚠️ Railway cấp PORT qua env, KHÔNG hardcode -> nếu sai Railway báo app không phản hồi
const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.get('/health', (_req, res) => res.send('ok')); // Railway healthcheck + giữ server thức

// Production: server phục vụ luôn client đã build -> 1 service, 1 URL, wss cùng domain
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer(app), pingInterval: 3000, pingMaxRetries: 3 }),
});
gameServer.define('torch', TorchRoom);
gameServer.listen(PORT).then(() => console.log(`🔥 Đuốc Soi Đường server :${PORT}`));
