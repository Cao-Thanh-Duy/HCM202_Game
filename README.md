# 🔥 Đuốc Soi Đường — HCM202 · Nhóm 9

Minigame multiplayer kiểu "đèn xanh đèn đỏ": trả lời câu hỏi để nhận stamina, di chuyển bằng **WASD** khi ngọn đuốc sáng, **dừng lại** khi đuốc tắt.
Thông điệp: *"Văn hóa soi đường cho quốc dân đi"* — đi khi không có ánh sáng thì phải về lại mốc.

**Stack:** Vite + TypeScript + Three.js (client) · Colyseus 0.16 + Express (server) · Railway (deploy)

---

## 1. Chạy local (5 phút)

```bash
npm install          # cài concurrently ở root
npm run setup        # cài server + client
npm run dev          # server :2567 + client :5173
```

- Mở `http://localhost:5173` → **Tạo phòng (máy chiếu)** → hiện mã 4 số.
- Mở tab ẩn danh khác → nhập tên + mã → **Vào phòng**.
- Máy khác trong cùng mạng LAN: `http://<IP-máy-bạn>:5173`.

## 2. Test tải 30 người

```bash
npm run bots -- <MÃ_PHÒNG> 30                         # local
npm run bots -- <MÃ_PHÒNG> 30 wss://<app>.up.railway.app   # server thật
```
Bot tự trả lời ngẫu nhiên (1–5s/câu), chạy khi đuốc sáng, ~10% bot "liều" chạy cả khi đuốc tắt. Terminal in RTT trung bình/p95 mỗi 5s.

## 3. Deploy Railway

1. Push repo lên GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → chọn repo.
3. Railway tự đọc `railway.json`: build `npm run build`, start `npm start`, healthcheck `/health`.
4. **Settings → Region: Southeast Asia (Singapore)** (ping VN thấp nhất).
5. **Settings → Networking → Generate Domain** → link dạng `https://<app>.up.railway.app`.
6. Mở link đó là chơi được (server phục vụ luôn client, WebSocket chạy cùng domain qua port 443).

> ⚠️ Không đặt biến `PORT` thủ công, Railway tự cấp. Server đã đọc `process.env.PORT`.

### Dự phòng
- **Render (Singapore):** cùng repo, Build `npm run build`, Start `npm start`. Gói free sẽ ngủ sau 15 phút → mở trang trước 5–10 phút.
- **Laptop + Cloudflare Tunnel:** `npm run build && npm start` rồi `cloudflared tunnel --url http://localhost:2567`.

## 4. Câu hỏi — import từ file

- **Bộ mặc định:** `server/data/questions.json` (sửa trực tiếp, deploy lại).
- **Import khi chơi:** ở sảnh chờ, host bấm **📄 Import câu hỏi** → chọn `.json` hoặc `.csv`. Câu lỗi tự bị bỏ qua, có thông báo `Đã nạp x/y câu`.

**JSON**
```json
[{ "q": "Câu hỏi?", "options": ["A", "B", "C", "D"], "a": 1, "quote": "Trích dẫn [GT tr.122]" }]
```
`a` = vị trí đáp án đúng, **tính từ 0**. Cho phép 2–4 đáp án, tối đa 50 câu.

**CSV** (mẫu: `server/data/questions_template.csv`, lưu UTF-8)
```
q,A,B,C,D,answer,quote
"Cần với kiệm, Bác ví như gì?",Hai bánh xe,Hai chân của con người,Hai cánh chim,Hai mặt đồng xu,B,[GT tr.122]
```
`answer` nhận `A/B/C/D` hoặc `1-4`. Ô có dấu phẩy thì bọc trong `"..."`.

## 5. Luật chơi & chỉnh luật

**Luồng ván:** Host tạo phòng (có QR) → người chơi quét QR / nhập mã → host **Bắt đầu** → chơi tối đa 10 phút → bảng kết quả.

- Mỗi người **tự trả lời câu hỏi theo nhịp riêng** (panel bên phải, phím 1–4), trả lời liên tục để tích stamina rồi đi một lượt. Thứ tự câu xáo riêng từng người.
- Panel thu gọn bằng **Q**; **hết stamina thì panel tự bật lên**. Khung hướng dẫn góc trái ẩn/hiện bằng **H**.
- Đuốc sáng/tắt liên tục suốt ván. Đi khi đuốc tắt → **về khu (checkpoint) gần nhất đã vào**, chưa vào khu nào → **về vạch xuất phát**.
- **Map chữ S dài 200m** (`shared/path.ts`): đi tự do WASD trong lòng đường, camera xoay theo khúc cua, W luôn là "tiến theo đường".
- Khu 1/2/3: đứng trong khu khi trả lời đúng được **+5 / +7 / +10 stamina**, đi nhanh hơn **10%**, và **lưu checkpoint**.
- **Cạm bẫy** (server random mỗi phòng): 💣 bom → về checkpoint (chưa có → vạch xuất phát); 🚧 hàng rào gai chắn nửa đường → mất 50% stamina (mỗi hàng rào gai phạt 1 lần, bị đưa về sau thì tính lại).
- Ngân hàng **30 câu**, phát xoay vòng không giới hạn.
- **Âm thanh chỉ phát ở máy host**: nhạc nền `client/public/sound/lobby.mp3` (sảnh/kết quả) và `ingame.mp3` (trong ván), hiệu ứng tổng hợp WebAudio. Có nút 🔊 + 2 thanh kéo 🎵 nhạc / 💥 hiệu ứng ở sảnh và trong ván. ⏹ để kết thúc sớm.

Tất cả thông số nằm trong **`shared/config.ts`**:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MAP_LENGTH` | 200 | Độ dài đường chữ S (m) |
| `ROAD_HALF_WIDTH` | 8 | Nửa bề rộng đường (m) |
| `BOMBS / FENCES` | 10 / 7 | Số bom / hàng rào gai mỗi phòng |
| `FENCE_STAMINA_MUL` | 0.5 | Vướng rào gai còn 50% stamina |
| `BASE_SPEED` | 2 | m/s. Chậm có chủ đích để stamina vắt qua lúc đuốc tắt |
| `STAMINA_MAX_Q / MIN_Q` | 10 / 5 | Stamina khi đúng (nhanh → chậm) |
| `QUESTION_MS` | 20s | Thời gian mỗi câu; hết giờ panel tự đóng, mở lại (Q) ra câu khác |
| `SPEED_WINDOW_MS` | 20s | Thưởng nhanh giảm dần trong khoảng này |
| `RESULT_MS` | 1.8s | Hiện đúng/sai + trích dẫn trước khi sang câu kế |
| `ZONES[].bonus` / `ZONE_SPEED_BONUS` | 5·7·10 / 10% | Thưởng khi đứng trong khu |
| `GAME_MS` | 10 phút | Thời lượng 1 ván |
| `TORCH_ON_MS` | 7s / 10s / 15s | Đuốc sáng: random 1 trong 3 mốc |
| `TORCH_OFF_MS` | 2–4s | Đuốc tắt: random trong khoảng |
| `TORCH_DIM_MS` | 1000 | Đuốc tối dần trước khi tắt |
| `GRACE_MS / MAX_LAG_COMP_MS` | 250 / 200 | Dung sai + bù ping tối đa |
| `ZONES` | 3 khu | Vị trí theo đường (s, d), màu, thưởng; cũng là checkpoint |

> QR dùng địa chỉ trang host đang mở. Chạy local thì QR là `localhost` (máy khác không quét được) → test bằng IP LAN hoặc deploy Railway.

## 6. Cấu trúc

```
shared/config.ts         luật game + khu + màu đội
shared/path.ts           hình học đường chữ S: chiếu (s,d), kẹp mép, khu, điểm hồi sinh
server/src/index.ts      Express + Colyseus, /health, phục vụ client/dist
server/src/TorchRoom.ts  phòng chơi: câu hỏi riêng từng người, stamina, đuốc, phạm luật, checkpoint
server/src/schema.ts     state đồng bộ
server/src/questions.ts  load + validate câu hỏi
server/src/bots.ts       load test
server/data/             questions.json, questions_template.csv
client/src/main.ts       luồng UI, input WASD, prediction
client/src/world.ts      scene Three.js: map, khu, cổng Cần–Kiệm–Liêm–Chính, ngọn đuốc
client/src/net.ts        kết nối, đồng bộ đồng hồ, reconnect
client/src/audio.ts      âm thanh WebAudio (chỉ host)
client/src/importer.ts   đọc JSON/CSV câu hỏi
```

## 7. Cơ chế quan trọng (để trả lời khi bị hỏi)

- **Server là trọng tài:** client chỉ gửi hướng phím, server tự tính vị trí + phạm luật → không hack tốc độ được.
- **Công bằng mạng:** mỗi người có deadline riêng = lúc tắt + 250ms + ½ ping (tối đa 200ms).
- **Đáp án ở server**, chỉ gửi xuống sau khi người đó trả lời; câu kế do server đẩy sau 1.8s (không skip được).
- **F5 / rớt mạng:** tự vào lại đúng nhân vật trong 120s.
- **Alt-Tab:** tự thả hết phím, tránh bị bắt oan.
- **Preset đồ họa thấp:** thêm `?low` vào URL (tắt bloom, giảm độ phân giải).

## 8. Checklist trước buổi thuyết trình

- [ ] Dò lại câu trích + số trang trong `questions.json` với PDF giáo trình
- [ ] Deploy Railway, mở link trên 2–3 laptop thật (wifi trường + 4G)
- [ ] Chạy `npm run bots -- <code> 30` vào server thật, xem p95 RTT
- [ ] Màn chiếu: zoom trình duyệt 100%, fullscreen (F11)
- [ ] Sau game: **Tải thống kê (JSON)** → lấy số liệu cho phần thực tiễn
- [ ] Không dùng ảnh AI về lãnh tụ
