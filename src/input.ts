/**
 * Reading a report: QuickBooks' 1099 and vendor-payment reports, Xero's, or any CSV.
 *
 * Two shapes are understood.
 *
 *   - **One row per payment**: a payee column and an amount column, and optionally how it was
 *     paid, what it was for (account, category or 1099 box), its date, and the payee's TIN, entity
 *     type, W-9 status and address. QuickBooks' detail reports group rows under a vendor's name
 *     and close each group with a "Total for …" row; both are handled.
 *   - **One row per payee with a column per box** (a 1099 summary): "Nonemployee compensation",
 *     "Rents", "Royalties", "Other income", "Medical and health care", "Gross proceeds paid to an
 *     attorney".
 *
 * Columns are found by their header names. When a report names them differently, `--map` says
 * which is which (`--map name=Supplier,amount="Paid out"`). Title rows above the header (report
 * name, company, period) are skipped.
 */
import { parseCsv } from "./csv.js";
import type { Kind, Method } from "./rules.js";
import { parseTin, type Tin } from "./tin.js";

export type Field =
  | "name"
  | "dba"
  | "amount"
  | "method"
  | "category"
  | "date"
  | "tin"
  | "tin_type"
  | "entity"
  | "w9"
  | "withheld"
  | "address1"
  | "address2"
  | "city"
  | "state"
  | "zip"
  | "country";

export const FIELDS: readonly Field[] = [
  "name",
  "dba",
  "amount",
  "method",
  "category",
  "date",
  "tin",
  "tin_type",
  "entity",
  "w9",
  "withheld",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "country",
];

/** Header names each field is known by, normalised (see `norm`). */
const ALIASES: Readonly<Record<Field, readonly string[]>> = {
  name: [
    "vendor",
    "vendor name",
    "vendor display name",
    "payee",
    "payee name",
    "name",
    "contact",
    "contact name",
    "supplier",
    "supplier name",
    "recipient",
    "recipient name",
    "display name",
    "legal name",
    "company",
    "company name",
  ],
  dba: ["dba", "doing business as", "business name", "name line 2", "dba name"],
  amount: [
    "amount",
    "total",
    "amount paid",
    "paid",
    "payment amount",
    "payment",
    "total paid",
    "net amount",
    "gross amount",
    "debit",
  ],
  method: [
    "payment method",
    "method",
    "paid by",
    "paid via",
    "payment type",
    "transaction type",
    "payment account",
    "paid from",
    "source",
  ],
  category: [
    "account",
    "category",
    "expense account",
    "expense category",
    "gl account",
    "account name",
    "1099 box",
    "box",
    "1099 category",
    "1099 type",
    "type",
  ],
  date: ["date", "payment date", "transaction date", "paid date", "paid on"],
  tin: [
    "tin",
    "tax id",
    "tax id number",
    "taxpayer id",
    "taxpayer id number",
    "tax identification number",
    "taxpayer identification number",
    "federal id",
    "federal tax id",
    "business id no",
    "ein",
    "ssn",
    "ein ssn",
    "tin ein ssn",
  ],
  tin_type: ["tin type", "tax id type", "id type"],
  entity: [
    "entity",
    "entity type",
    "tax classification",
    "federal tax classification",
    "w 9 classification",
    "w9 classification",
    "business type",
    "vendor type",
  ],
  w9: [
    "w 9",
    "w9",
    "w 9 on file",
    "w9 on file",
    "w 9 received",
    "w9 received",
    "has w 9",
    "w 9 status",
    "w9 status",
  ],
  withheld: [
    "federal income tax withheld",
    "backup withholding",
    "federal withholding",
    "withheld",
    "tax withheld",
  ],
  address1: [
    "address",
    "address 1",
    "address line 1",
    "street",
    "street address",
    "billing address",
    "billing address line 1",
    "address1",
  ],
  address2: ["address 2", "address line 2", "suite", "billing address line 2", "address2"],
  city: ["city", "town", "city town", "billing city"],
  state: ["state", "st", "province", "region", "billing state"],
  zip: ["zip", "zip code", "postal code", "postcode", "billing zip", "billing postal code"],
  country: ["country", "billing country"],
};

/** Lower case, letters and digits only, single spaces. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A summary column's box, from its header. */
export function boxColumnKind(header: string): Kind | null {
  const h = norm(header);
  if (/nonemployee|\bnec\b/.test(h)) return "services";
  if (/gross proceeds/.test(h)) return "attorney_proceeds";
  if (/attorney|legal/.test(h)) return "attorney_fees";
  if (/\brents?\b/.test(h)) return "rents";
  if (/royalt/.test(h)) return "royalties";
  if (/other income/.test(h)) return "other_income";
  if (/medical|health care/.test(h)) return "medical";
  return null;
}

export class InputError extends Error {
  constructor(
    readonly code: string,
    readonly cause_: string,
    readonly fix: string,
  ) {
    super(cause_);
  }
}

/** `name=Vendor,amount="Paid out"` → { name: "Vendor", amount: "Paid out" } */
export function parseMap(spec: string | undefined): Partial<Record<Field, string>> {
  if (!spec) return {};
  const out: Partial<Record<Field, string>> = {};
  const parts = spec.match(/(?:[^,"]+|"[^"]*")+/g) ?? [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 1)
      throw new InputError(
        "BAD_MAP",
        `\`${part}\` in --map is not field=Header`,
        `Write --map like name=Vendor,amount="Amount Paid". Fields: ${FIELDS.join(", ")}.`,
      );
    const key = part.slice(0, eq).trim() as Field;
    const value = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (!FIELDS.includes(key))
      throw new InputError(
        "BAD_MAP",
        `--map names \`${key}\`, which is not a field`,
        `Use only: ${FIELDS.join(", ")}.`,
      );
    out[key] = value;
  }
  return out;
}

export interface Payment {
  payee: string;
  /** cents; negative for a refund or credit */
  cents: number;
  kind: Kind;
  /** true when nothing in the row said what it was for, so it was taken to be services */
  kindAssumed: boolean;
  method: Method;
  /** what the row said about the method, for the reason text */
  methodLabel: string;
  date: string | null;
  row: number;
}

export interface PayeeInfo {
  name: string;
  dba: string | null;
  tin: Tin | null;
  /** a TIN column held something that is not nine digits */
  tinUnreadable: boolean;
  entityLabel: string | null;
  w9: boolean | null;
  withheldCents: number;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export interface ParsedReport {
  shape: "payments" | "summary";
  headerRow: number;
  columns: Partial<Record<Field, string>>;
  boxColumns: { header: string; kind: Kind }[];
  payments: Payment[];
  payees: Map<string, PayeeInfo>;
  skippedRows: { row: number; why: string }[];
}

/** Dollars as written in a report: $1,234.56, (1,234.56) for a credit, -1234.56, 1234. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

/** What a row's account, category or box says it was for. */
export function kindFromText(text: string): Kind | null {
  const t = norm(text);
  if (!t) return null;
  const box = boxColumnKind(text);
  if (box) return box;
  if (/\blaw\b|lawyer|counsel|attorney|legal/.test(t)) return "attorney_fees";
  if (/\brent|\blease|rental/.test(t)) return "rents";
  if (/royalt/.test(t)) return "royalties";
  if (/medical|health|physician|doctor|dental|clinic|therap/.test(t)) return "medical";
  if (/\bprize|\baward/.test(t)) return "other_income";
  if (
    /merchandise|inventory|cost of goods|\bcogs\b|freight|shipping|postage|telephone|phone service|office supplies|\bsupplies\b|storage/.test(
      t,
    )
  )
    return "goods";
  if (
    /contract|consult|professional|service|freelanc|subcontract|design|develop|commission|\bfees?\b|labor|labour|outside|photograph|writing|translat|deliver|cleaning|repair|maintenance|marketing|bookkeeping|accounting|coaching|tutor|installation|landscap|janitorial|programming|video|editing/.test(
      t,
    )
  )
    return "services";
  return null;
}

/**
 * How a row was paid. Card brands and card wording → card; payment apps that settle as third party
 * networks → network; checks, ACH, wires, bank bill pay, Zelle and cash → direct. Zelle moves money
 * bank to bank and is not a third party settlement organization, so a Zelle payment stays yours to
 * report. A PayPal or Venmo transfer marked personal ("friends and family") is not a third party
 * network transaction either.
 */
export function methodFromText(text: string): Method {
  const t = norm(text);
  if (!t) return "direct";
  if (/friends? (and|&)? ?family|\bf f\b|personal/.test(t)) return "direct";
  if (
    /credit card|debit card|charge card|\bcard\b|visa|mastercard|master card|amex|american express|discover/.test(
      t,
    )
  )
    return "card";
  if (
    /paypal|venmo|stripe|square|cash app|cashapp|shopify payments|etsy|amazon pay|google pay|apple pay|upwork|fiverr/.test(
      t,
    )
  )
    return "network";
  return "direct";
}

function yesNo(raw: string): boolean | null {
  const t = norm(raw);
  if (!t) return null;
  if (/^(y|yes|true|1|on file|received|collected|have|done)\b/.test(t)) return true;
  if (/^\d{4} \d{1,2} \d{1,2}$|^\d{1,2} \d{1,2} \d{2,4}$/.test(t)) return true; // a date it arrived
  if (/^(n|no|false|0|missing|none|not|requested|pending)\b/.test(t)) return false;
  return null;
}

/** ISO date from 2026-03-14, 03/14/2026 or 14 Mar 2026; null when it cannot tell. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s) && /\d{4}/.test(s))
    return new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return null;
}

function findHeader(
  rows: string[][],
  map: Partial<Record<Field, string>>,
): {
  index: number;
  columns: Partial<Record<Field, number>>;
  boxes: { col: number; kind: Kind }[];
} | null {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i]!.map(norm);
    const columns: Partial<Record<Field, number>> = {};
    const taken = new Set<number>();
    for (const f of FIELDS) {
      const wanted = map[f];
      // the first alias the row has wins, so "Payment Method" beats "Transaction Type"
      const idx = wanted
        ? cells.indexOf(norm(wanted))
        : (ALIASES[f]
            .map((a) => cells.findIndex((c, i) => c === a && !taken.has(i)))
            .find((i) => i >= 0) ?? -1);
      if (idx >= 0) {
        columns[f] = idx;
        taken.add(idx);
      }
    }
    const boxes = rows[i]!.map((h, col) => ({ col, kind: boxColumnKind(h) })).filter(
      (b): b is { col: number; kind: Kind } =>
        b.kind !== null && b.col !== columns.amount && b.col !== columns.category,
    );
    if (columns.name === undefined || (columns.amount === undefined && boxes.length === 0))
      continue;
    // A summary's "Total" column adds up its box columns; the boxes are what count. A column the
    // user named with --map amount= always wins.
    const amountIsTotal =
      columns.amount !== undefined && /^total/.test(cells[columns.amount] ?? "") && !map.amount;
    const summary = boxes.length > 0 && (columns.amount === undefined || amountIsTotal);
    if (summary) delete columns.amount;
    return { index: i, columns, boxes: summary ? boxes : [] };
  }
  return null;
}

const EMPTY_ADDRESS = { line1: "", line2: "", city: "", state: "", zip: "", country: "" };

export function readReport(text: string, mapSpec?: string): ParsedReport {
  const map = parseMap(mapSpec);
  const rows = parseCsv(text);
  const header = findHeader(rows, map);
  if (!header) {
    const missing = Object.entries(map)
      .filter(([, h]) => !rows.slice(0, 25).some((r) => r.map(norm).includes(norm(h!))))
      .map(([f, h]) => `${f}="${h}"`);
    throw new InputError(
      "NO_HEADER",
      missing.length
        ? `--map names columns this file does not have: ${missing.join(", ")}`
        : "found no header row with a payee column and an amount (or 1099 box) column in the first 25 rows",
      'Name the columns with --map, e.g. --map name="Vendor",amount="Amount", or export the 1099 or vendor payments report as CSV.',
    );
  }
  const { index, columns: cols, boxes } = header;
  const headerCells = rows[index]!;
  const cell = (r: string[], f: Field): string => {
    const c = cols[f];
    return c === undefined ? "" : (r[c] ?? "").trim();
  };

  const payments: Payment[] = [];
  const payees = new Map<string, PayeeInfo>();
  const skippedRows: { row: number; why: string }[] = [];
  let group = "";

  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNo = i + 1;
    if (r.every((c) => c.trim() === "")) continue;
    const first = (r[0] ?? "").trim();
    const nameCell = cell(r, "name");
    if (/^total\b/i.test(first) || /^total\b/i.test(nameCell)) continue;
    const amountCells = boxes.length
      ? boxes.map((b) => ({ kind: b.kind as Kind | null, cents: parseMoney(r[b.col] ?? "") }))
      : [{ kind: null as Kind | null, cents: parseMoney(cell(r, "amount")) }];
    const anyAmount = amountCells.some((a) => a.cents !== null);
    // a QuickBooks group heading: the vendor's name alone on its row
    if (!anyAmount) {
      const filled = r.filter((c) => c.trim() !== "");
      if (filled.length === 1 && first) group = first;
      else if (filled.length > 0) skippedRows.push({ row: rowNo, why: "no amount" });
      continue;
    }
    const payee = nameCell || group;
    if (!payee) {
      skippedRows.push({ row: rowNo, why: "no payee name" });
      continue;
    }

    let info = payees.get(payee);
    if (!info) {
      info = {
        name: payee,
        dba: null,
        tin: null,
        tinUnreadable: false,
        entityLabel: null,
        w9: null,
        withheldCents: 0,
        address: { ...EMPTY_ADDRESS },
      };
      payees.set(payee, info);
    }
    const tinRaw = cell(r, "tin");
    if (tinRaw && !info.tin) {
      const tin = parseTin(tinRaw, cell(r, "tin_type"));
      if (tin) info.tin = tin;
      else info.tinUnreadable = true;
    }
    info.dba ||= cell(r, "dba") || null;
    info.entityLabel ||= cell(r, "entity") || null;
    const w9 = yesNo(cell(r, "w9"));
    if (w9 !== null) info.w9 = info.w9 === true ? true : w9;
    info.withheldCents += Math.max(0, parseMoney(cell(r, "withheld")) ?? 0);
    const a = info.address;
    a.line1 ||= cell(r, "address1");
    a.line2 ||= cell(r, "address2");
    a.city ||= cell(r, "city");
    a.state ||= cell(r, "state");
    a.zip ||= cell(r, "zip");
    a.country ||= cell(r, "country");

    const methodText = cell(r, "method");
    const method = methodFromText(methodText);
    const categoryText = cell(r, "category");
    const date = parseDate(cell(r, "date"));
    for (const amt of amountCells) {
      if (amt.cents === null || amt.cents === 0) continue;
      const fromText = kindFromText(categoryText);
      const kind = amt.kind ?? fromText ?? "services";
      payments.push({
        payee,
        cents: amt.cents,
        kind,
        kindAssumed: amt.kind === null && fromText === null,
        method,
        methodLabel: methodText,
        date,
        row: rowNo,
      });
    }
  }

  const columns: Partial<Record<Field, string>> = {};
  for (const f of FIELDS) {
    const c = cols[f];
    if (c !== undefined) columns[f] = headerCells[c] ?? "";
  }
  return {
    shape: boxes.length ? "summary" : "payments",
    headerRow: index + 1,
    columns,
    boxColumns: boxes.map((b) => ({ header: headerCells[b.col] ?? "", kind: b.kind })),
    payments,
    payees,
    skippedRows,
  };
}
