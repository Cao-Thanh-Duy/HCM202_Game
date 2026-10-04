// Config dùng chung cho server + client. Chỉnh luật game ở ĐÂY, không hardcode chỗ khác.
export const CFG = {
  MAP_LENGTH: 150,          // m, trục X: 0 = vạch xuất phát, 150 = đích
  MAP_HALF_WIDTH: 15,       // m, trục Z: -15..15
  BASE_SPEED: 2,            // m/s — ⚠️ chậm có chủ đích: 10 stamina mất ~5s, dễ vắt qua lúc đuốc tắt -> có hồi hộp
  ZONE_SPEED_BONUS: 0.1,    // +10% tốc độ khi đứng trong khu
  ZONE_STAMINA_BONUS: 5,    // +5 stamina mỗi câu đúng khi đang đứng trong khu
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

  MAX_PLAYERS: 40,
};

// 3 khu đặt lệch 2 bên đường: đi vòng tốn stamina nhưng được thưởng + làm CHECKPOINT
export const ZONES = [
  { id: 1, name: 'Khu 1 · Văn hóa',   x0: 40,  x1: 60,  z0: 4,   z1: 14, color: 0xd4a017 },
  { id: 2, name: 'Khu 2 · Đạo đức',   x0: 80,  x1: 100, z0: -14, z1: -4, color: 0xc0392b },
  { id: 3, name: 'Khu 3 · Con người', x0: 120, x1: 140, z0: 4,   z1: 14, color: 0xb0703a },
];

export const zoneAt = (x: number, z: number) =>
  ZONES.find(k => x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1)?.id ?? 0;

// Điểm hồi sinh khi phạm luật: giữa khu đã vào gần nhất, chưa vào khu nào -> vạch xuất phát
export const respawnOf = (cpZone: number) => {
  const k = ZONES[cpZone - 1];
  return k ? { x: (k.x0 + k.x1) / 2, z: (k.z0 + k.z1) / 2 } : { x: 0, z: 0 };
};

export const TEAM_COLORS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xe67e22, 0xecf0f1,
  0xff6b9d, 0x95a5a6, 0x5dade2, 0xd35400,
];

export type Phase = 'lobby' | 'play' | 'end';
export type Torch = 'on' | 'dim' | 'off';
