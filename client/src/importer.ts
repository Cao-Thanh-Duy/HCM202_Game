// Đọc file câu hỏi do host chọn -> mảng {q, options, a, quote}. Server sẽ validate lại lần nữa.
// JSON: [{ "q": "...", "options": ["A","B","C","D"], "a": 0, "quote": "..." }]
// CSV (UTF-8, có dòng tiêu đề): q,A,B,C,D,answer,quote   — answer nhận A/B/C/D hoặc 1-4
export async function readQuestionFile(file: File) {
  const text = (await file.text()).replace(/^﻿/, ''); // ⚠️ Excel lưu CSV UTF-8 hay kèm BOM
  if (file.name.toLowerCase().endsWith('.json')) return JSON.parse(text);
  const rows = parseCSV(text).filter(r => r.some(c => c.trim()));
  return rows.slice(1).map(([q, A, B, C, D, ans = '', quote = '']) => {
    const options = [A, B, C, D].map(s => (s ?? '').trim()).filter(Boolean);
    const k = ans.trim().toUpperCase();
    const a = /^[A-D]$/.test(k) ? k.charCodeAt(0) - 65 : Number(k) - 1;
    return { q: q?.trim(), options, a, quote: quote.trim() };
  });
}

// CSV parser tối giản: hỗ trợ "ô có dấu phẩy" và "" (escape dấu nháy)
function parseCSV(s: string): string[][] {
  const rows: string[][] = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rows[rows.length - 1].push(cell); cell = ''; rows.push([]);
    } else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  return rows;
}
