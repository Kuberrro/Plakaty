/** Neutralizuje treści, które arkusz mógłby uznać za formułę. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(cell: string, sep: string): string {
  return cell.includes(sep) || /["\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** CSV dla polskiego Excela: BOM + średnik. Liczby nie są traktowane jako tekst do ochrony. */
export function toCsv(rows: (string | number | null)[][], sep = ';'): string {
  const body = rows
    .map((r) => r.map((c) => (typeof c === 'number' ? String(c) : quote(safeCell(c ?? ''), sep))).join(sep))
    .join('\r\n');
  return `﻿${body}\r\n`;
}

/** Parser RFC 4180: cudzysłowy, wieloliniowe pola, separator ; lub , (wykrywany z nagłówka). */
export function parseCsv(input: string): { header: string[]; rows: string[][] } {
  const text = input.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = false;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (inQuotes) throw new Error('Niezamknięty cudzysłów w pliku CSV');
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return { header, rows };
}
