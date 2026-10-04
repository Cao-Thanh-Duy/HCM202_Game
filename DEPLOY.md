# 🚀 Deploy "Đuốc Soi Đường" lên Railway

> 1 service duy nhất: server Node vừa chạy game (WebSocket) vừa phát luôn trang web → 1 link dùng cho cả host lẫn người chơi.

## Bước 1 — Đẩy code lên GitHub (làm trên máy)

```powershell
cd C:\FPTU\FPTU_FA26\HCM202_Game
git add .
git commit -m "Duoc Soi Duong - ban deploy"
git push -u origin main
```
⚠️ Kiểm tra `node_modules/` và `dist/` **không** bị đẩy lên (đã có trong `.gitignore`).

## Bước 2 — Tạo project Railway

1. Vào **railway.com** → đăng nhập bằng GitHub.
2. Chọn gói **Hobby ($5/tháng, kèm $5 credit)**. Gói free có giới hạn, dễ bị dừng giữa buổi.
3. **New Project → Deploy from GitHub repo → `Cao-Thanh-Duy/HCM202_Game`**.
4. Railway tự đọc `railway.json`: build `npm run build`, start `npm start`, healthcheck `/health`. **Không cần điền gì thêm.**

## Bước 3 — Cấu hình (1 lần)

Vào service vừa tạo → **Settings**:

| Mục | Đặt thành | Vì sao |
|---|---|---|
| **Region** | **Southeast Asia (Singapore)** | Ping từ VN ~30–50ms |
| **Replicas** | **1** | Phòng chơi lưu trong RAM của 1 server, 2 replica → người chơi bị chia sang 2 server khác nhau |
| **Serverless / App Sleeping** | **Tắt** | Bật thì server ngủ, lần vào đầu phải chờ |
| **Networking → Generate Domain** | Bấm tạo | Ra link `https://<tên>.up.railway.app` |

❌ **Không** tự thêm biến `PORT` — Railway tự cấp, server đã đọc `process.env.PORT`.

## Bước 4 — Kiểm tra

1. Mở `https://<tên>.up.railway.app/health` → thấy `ok`.
2. Mở `https://<tên>.up.railway.app` → **Tạo phòng** → QR giờ trỏ đúng link Railway, điện thoại/laptop khác quét là vào.
3. Test tải 30 người từ máy bạn:
   ```powershell
   npm run bots -- <MÃ_PHÒNG> 30 wss://<tên>.up.railway.app
   ```
   Nhìn dòng `RTT ms avg / p95` — dưới ~100ms là mượt.

## Bước 5 — Cập nhật sau này

Sửa code → `git add . ; git commit -m "..." ; git push` → Railway **tự build & deploy lại** (~1–2 phút).

⚠️ **Đừng push trong lúc đang chơi**: deploy lại = server khởi động lại = phòng đang chơi mất hết.

## Checklist ngày thuyết trình

- [ ] Trước giờ 10 phút: mở link, tạo phòng thử 1 lần (đánh thức + kiểm tra)
- [ ] Không push code từ 1 tiếng trước buổi
- [ ] Máy chiếu: Chrome, **F11** toàn màn hình, click 1 lần vào trang để bật âm thanh
- [ ] Gửi link/QR cho lớp; ai dùng wifi trường bị chặn thì bật 4G
- [ ] Hết ván: **Tải thống kê (JSON)** để lấy số liệu cho phần thực tiễn

## Dự phòng nếu Railway lỗi

| Phương án | Cách làm |
|---|---|
| **Render (Singapore)** | New → Web Service → chọn repo · Build `npm run build` · Start `npm start` · Region Singapore. Gói free ngủ sau 15 phút → mở link trước 10 phút |
| **Laptop + Cloudflare Tunnel** | `npm run build ; npm start` rồi `cloudflared tunnel --url http://localhost:2567` → dùng link `trycloudflare.com` nó in ra |
