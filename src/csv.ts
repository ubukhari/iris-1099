/**
 * CSV in and out, RFC 4180: quoted fields may hold commas, quotes ("" inside quotes) and line
 * breaks. A UTF-8 byte-order mark (Excel writes one) is dropped. Nothing here guesses at
 * delimiters: QuickBooks, Xero and Excel all write commas.
 */

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** One field, quoted only when it has to be. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows to CSV text, CRLF line ends (what Excel and the IRS templates use), with a final CRLF. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
