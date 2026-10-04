import fs from 'fs';
import path from 'path';

// a = index đáp án đúng (0-based). quote = câu trích hiện lúc reveal (không bắt buộc).
export interface Question { q: string; options: string[]; a: number; quote?: string }

// Lọc dữ liệu import: bỏ câu lỗi thay vì làm sập phòng.
// Hỗ trợ 2–4 đáp án; client chỉ hiện số nút đúng bằng options.length.
export function sanitize(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: any) => {
    const options = Array.isArray(r?.options) ? r.options.map(String).filter(Boolean).slice(0, 4) : [];
    const a = Number(r?.a);
    if (!r?.q || options.length < 2 || !Number.isInteger(a) || a < 0 || a >= options.length) return [];
    return [{ q: String(r.q).slice(0, 300), options: options.map((o: string) => o.slice(0, 120)), a, quote: String(r.quote ?? '').slice(0, 300) }];
  }).slice(0, 50);
}

// Bộ mặc định: server/data/questions.json (sửa file này hoặc host import file khác trong sảnh)
const file = process.env.QUESTIONS_FILE || path.resolve(__dirname, '../data/questions.json');
export const DEFAULT_QUESTIONS = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
