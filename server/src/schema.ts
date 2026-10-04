import { Schema, MapSchema, type } from '@colyseus/schema';

// ⚠️ Cần "useDefineForClassFields": false + "experimentalDecorators": true trong tsconfig,
// nếu không @type sẽ không bắt được field -> client nhận state rỗng.
export class Player extends Schema {
  @type('string') name = '';
  @type('uint8') color = 0;
  @type('float32') x = 0;
  @type('float32') z = 0;
  @type('float32') rot = 0;
  @type('float32') stamina = 0;
  @type('uint8') zone = 0;       // khu đang đứng, 0 = ngoài khu
  @type('uint8') cpZone = 0;     // checkpoint = khu đã vào xa nhất, 0 = vạch xuất phát
  @type('uint16') qDone = 0;     // số câu đã trả lời (không giới hạn -> uint16, uint8 tràn ở 255)
  @type('uint16') qRight = 0;    // số câu đúng
  @type('boolean') stunned = false; // vừa phạm luật, khóa đến khi đuốc sáng lại
  @type('uint8') caught = 0;
  @type('uint8') rank = 0;       // thứ tự về đích, 0 = chưa về
  @type('boolean') online = true;
}

// Câu hỏi KHÔNG nằm trong state: mỗi người có câu riêng, gửi bằng message riêng (chống nhìn bài + giấu đáp án)
export class GameState extends Schema {
  @type('string') code = '';
  @type('string') phase = 'lobby';
  @type('string') torch = 'on';
  @type('uint8') total = 0;        // tổng số câu
  @type('float64') phaseEnd = 0;   // mốc server-time (ms) kết thúc ván
  @type({ map: Player }) players = new MapSchema<Player>();
}
