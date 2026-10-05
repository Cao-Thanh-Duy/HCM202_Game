// Config dùng chung cho server + client. Chỉnh luật game ở ĐÂY, không hardcode chỗ khác.
export const CFG = {
  MAP_LENGTH: 200,          // m, chiều dài đường thẳng (xem shared/path.ts)
  ROAD_HALF_WIDTH: 8,       // m, nửa bề rộng đường đi được (đi ra ngoài sẽ bị chặn lại ở mép)
  BASE_SPEED: 2,            // m/s — ⚠️ chậm có chủ đích: 10 stamina mất ~5s, dễ vắt qua lúc đuốc tắt -> có hồi hộp
  ZONE_SPEED_BONUS: 0.1,    // +10% tốc độ khi đứng trong khu
  STAMINA_MAX_Q: 10,        // đúng ngay lập tức
  STAMINA_MIN_Q: 5,         // đúng sau SPEED_WINDOW_MS trở đi
  SPEED_WINDOW_MS: 20_000,  // thưởng nhanh giảm dần suốt 20s của câu (10 -> 5)
  QUESTION_MS: 20_000,      // mỗi câu 20s; hết giờ không trả lời -> panel tự đóng, mở lại ra câu khác
  RESULT_MS: 1800,          // hiện đúng/sai + trích dẫn rồi mới sang câu kế (chống spam đoán bừa)

  TICK_MS: 50,              // server 20Hz
  GAME_MS: 10 * 60_000,     // tổng thời gian 1 ván (host có thể kết thúc sớm)

  TORCH_ON_MS: [7000, 10_000, 15_000],             // đuốc sáng: random 1 trong 3 mốc 7s / 10s / 15s
  TORCH_OFF_MS: [2000, 4000] as [number, number],
  TORCH_DIM_MS: 1000,       // đuốc tối dần trước khi tắt
  GRACE_MS: 250,            // dung sai sau khi tắt hẳn
  MAX_LAG_COMP_MS: 200,     // bù ping tối đa, tránh lợi dụng lag
  MOVE_EPS: 0.1,            // m, rung tay dưới mức này không tính là di chuyển

  // Cạm bẫy (server random vị trí mỗi phòng)
  BOMBS: 10,                // số quả bom
  FENCES: 7,                // số hàng rào (mỗi cái chắn nửa đường, đi vòng được)
  BOMB_RADIUS: 1.3,         // m
  FENCE_STAMINA_MUL: 0.5,   // đâm hàng rào: còn 50% stamina
  TRAP_IMMUNE_MS: 1500,     // vừa dính bẫy / hồi sinh -> miễn bẫy 1.5s (tránh dính liên hoàn)

  MAX_PLAYERS: 40,
};

// 3 khu, toạ độ theo ĐƯỜNG: s = mét tính từ vạch xuất phát, d = lệch sang phải(+)/trái(-) so với tim đường.
// Đặt lệch 1 bên đường -> muốn ăn thưởng phải đi vòng. bonus = stamina cộng thêm mỗi câu đúng khi đứng trong khu.
export const ZONES = [
  { id: 1, name: 'Khu 1', s0: 50,  s1: 70,  d0: -7.5, d1: -2, color: 0xd4a017, bonus: 5 },
  { id: 2, name: 'Khu 2', s0: 105, s1: 125, d0: 2,    d1: 7.5, color: 0xc0392b, bonus: 7 },
  { id: 3, name: 'Khu 3', s0: 160, s1: 180, d0: -7.5, d1: -2, color: 0xb0703a, bonus: 10 },
];

export const TEAM_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xe67e22, 0xecf0f1,
  0xff6b9d, 0x95a5a6, 0x5dade2, 0xd35400,
];

export type Phase = 'lobby' | 'play' | 'end';
export type Torch = 'on' | 'dim' | 'off';
