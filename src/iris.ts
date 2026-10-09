/**
 * IRIS Taxpayer Portal CSVs: one file per form, at most 100 records each, columns in the order of
 * the IRS's tax-year-2025 template formatting guidelines (columns A–BB for the 1099-NEC, A–BL for
 * the 1099-MISC), and every value cleaned to the characters and lengths those guidelines allow.
 *
 * What is known and what is not:
 *
 *   - The guidelines name each column and its rules; the template itself is handed out behind the
 *     portal's login, and "The IRIS system validates the CSV column header descriptions." So the
 *     header row written here is the guidelines' field names. If the portal refuses the headers,
 *     download the template from the portal and pass it with `--template`: the files are then
 *     written under its exact header row, every column matched by name.
 *   - The newest guidelines are for tax year 2025 (updated 14 Jan 2026). For 2026 payments the
 *     IRS has not posted a template yet, and the December 2026 forms add boxes (1b–1d on the
 *     1099-NEC; 13a, 13b and 14 on the 1099-MISC), so the 2026 files are written in the 2025
 *     layout and say so in their names and in LAYOUT.txt.
 *   - Batches of 100 records: the limit in the IRIS FAQ. The IRS said in August 2025 that from
 *     TY25/PY26 a file may hold 250; 100 is within both.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, toCsv } from "./csv.js";
import type { Assessment, Decision } from "./decide.js";
import type { PayeeInfo } from "./input.js";
import { norm } from "./input.js";
import type { Year } from "./rules.js";
import { formatTin, parseTin, type Tin, type TinType } from "./tin.js";

export const BATCH_SIZE = 100;
/** The tax year whose template layout is built in. */
export const LAYOUT_YEAR = 2025;

export type IrisForm = "1099-NEC" | "1099-MISC";

/** Our name for each value a row can carry. */
type Key =
  | "form_type"
  | "tax_year"
  | "payer_tin_type"
  | "payer_tin"
  | "payer_name_type"
  | "payer_name1"
  | "payer_name2"
  | "payer_first"
  | "payer_middle"
  | "payer_last"
  | "payer_suffix"
  | "payer_country"
  | "payer_address1"
  | "payer_address2"
  | "payer_city"
  | "payer_state"
  | "payer_zip"
  | "payer_phone_type"
  | "payer_phone"
  | "recipient_tin_type"
  | "recipient_tin"
  | "recipient_name_type"
  | "recipient_name1"
  | "recipient_name2"
  | "recipient_first"
  | "recipient_middle"
  | "recipient_last"
  | "recipient_suffix"
  | "recipient_country"
  | "recipient_address1"
  | "recipient_address2"
  | "recipient_city"
  | "recipient_state"
  | "recipient_zip"
  | "office_code"
  | "account_number"
  | "fatca"
  | "second_tin_notice"
  | "nec_box1"
  | "nec_box2"
  | "nec_box3"
  | "box4_withheld"
  | "misc_box1"
  | "misc_box2"
  | "misc_box3"
  | "misc_box5"
  | "misc_box6"
  | "misc_box7"
  | "misc_box8"
  | "misc_box9"
  | "misc_box10"
  | "misc_box11"
  | "misc_box12"
  | "misc_box15"
  | "cfsf"
  | `state${1 | 2}_${"code" | "withheld" | "number" | "income" | "local" | "special"}`;

type Column = readonly [header: string, key: Key];

const COMMON_HEAD: readonly Column[] = [
  ["Form Type", "form_type"],
  ["Tax Year", "tax_year"],
  ["Payer TIN Type", "payer_tin_type"],
  ["Payer Taxpayer ID Number", "payer_tin"],
  ["Payer Name Type", "payer_name_type"],
  ["Payer Business or Entity Name Line 1", "payer_name1"],
  ["Payer Business or Entity Name Line 2", "payer_name2"],
  ["Payer First Name", "payer_first"],
  ["Payer Middle Name", "payer_middle"],
  ["Payer Last Name (Surname)", "payer_last"],
  ["Payer Suffix", "payer_suffix"],
  ["Payer Country", "payer_country"],
  ["Payer Address Line 1", "payer_address1"],
  ["Payer Address Line 2", "payer_address2"],
  ["Payer City/Town", "payer_city"],
  ["Payer State/Province/Territory", "payer_state"],
  ["Payer ZIP/Postal Code", "payer_zip"],
  ["Payer Phone Type", "payer_phone_type"],
  ["Payer Phone", "payer_phone"],
  ["Recipient TIN Type", "recipient_tin_type"],
  ["Recipient Taxpayer ID Number", "recipient_tin"],
  ["Recipient Name Type", "recipient_name_type"],
  ["Recipient Business or Entity Name Line 1", "recipient_name1"],
  ["Recipient Business or Entity Name Line 2", "recipient_name2"],
  ["Recipient First Name", "recipient_first"],
  ["Recipient Middle Name", "recipient_middle"],
  ["Recipient Last Name (Surname)", "recipient_last"],
  ["Recipient Suffix", "recipient_suffix"],
  ["Recipient Country", "recipient_country"],
  ["Recipient Address Line 1", "recipient_address1"],
  ["Recipient Address Line 2", "recipient_address2"],
  ["Recipient City/Town", "recipient_city"],
  ["Recipient State/Province/Territory", "recipient_state"],
  ["Recipient ZIP/Postal Code", "recipient_zip"],
  ["Office Code", "office_code"],
  ["Form Account Number", "account_number"],
];

const STATES: readonly Column[] = ([1, 2] as const).flatMap((n): Column[] => [
  [`State ${n}`, `state${n}_code`],
  [`State ${n} - State Tax Withheld`, `state${n}_withheld`],
  [`State ${n} - State/Payer state number`, `state${n}_number`],
  [`State ${n} - State income`, `state${n}_income`],
  [`State ${n} - Local income tax withheld`, `state${n}_local`],
  [`State ${n} - Special Data Entries`, `state${n}_special`],
]);

/** Columns A–BB of the TY2025 1099-NEC template formatting guidelines. */
export const NEC_COLUMNS: readonly Column[] = [
  ...COMMON_HEAD,
  ["2nd TIN Notice", "second_tin_notice"],
  ["Box 1 - Nonemployee Compensation", "nec_box1"],
  [
    "Box 2 - Payer made direct sales totaling $5,000 or more of consumer products to a recipient for resale",
    "nec_box2",
  ],
  ["Box 3 - Excess golden parachute payments", "nec_box3"],
  ["Box 4 - Federal income tax withheld", "box4_withheld"],
  ["Combined Federal/State Filing (CF/SF)", "cfsf"],
  ...STATES,
];

/** Columns A–BL of the TY2025 1099-MISC template formatting guidelines. */
export const MISC_COLUMNS: readonly Column[] = [
  ...COMMON_HEAD,
  ["FATCA Filing Requirements", "fatca"],
  ["2nd TIN Notice", "second_tin_notice"],
  ["Box 1 - Rents", "misc_box1"],
  ["Box 2 - Royalties", "misc_box2"],
  ["Box 3 - Other income", "misc_box3"],
  ["Box 4 - Federal income tax withheld", "box4_withheld"],
  ["Box 5 - Fishing boat proceeds", "misc_box5"],
  ["Box 6 - Medical and health care payments", "misc_box6"],
  [
    "Box 7 - Direct sales of $5,000 or more of consumer products to a recipient for resale",
    "misc_box7",
  ],
  ["Box 8 - Substitute payments in lieu of dividends or interest", "misc_box8"],
  ["Box 9 - Crop insurance proceeds", "misc_box9"],
  ["Box 10 - Gross proceeds paid to an attorney", "misc_box10"],
  ["Box 11 - Fish purchased for resale", "misc_box11"],
  ["Box 12 - Section 409A deferrals", "misc_box12"],
  ["Box 15 - Nonqualified deferred compensation", "misc_box15"],
  ["Combined Federal/State Filing (CF/SF)", "cfsf"],
  ...STATES,
];

export const LAYOUTS: Readonly<Record<IrisForm, readonly Column[]>> = {
  "1099-NEC": NEC_COLUMNS,
  "1099-MISC": MISC_COLUMNS,
};

/** The filer, from --payer <file.json>. Its TIN is masked everywhere but the CSVs. */
export interface Payer {
  name: string;
  name2: string;
  tin: Tin | null;
  tinType: "SSN" | "EIN";
  country: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export function readPayer(json: unknown): Payer {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const declared = s("tin_type").toUpperCase() === "SSN" ? "SSN" : "EIN";
  const tin = parseTin(s("tin"), declared);
  return {
    name: s("name"),
    name2: s("name_line2") || s("dba"),
    tin,
    tinType: tin?.type === "SSN" ? "SSN" : declared,
    country: s("country") || "US",
    address1: s("address1") || s("address"),
    address2: s("address2"),
    city: s("city"),
    state: s("state"),
    zip: s("zip"),
    phone: s("phone"),
  };
}

// ---------------------------------------------------------------------------------------------
// Cleaning values to the guidelines' character sets and lengths
// ---------------------------------------------------------------------------------------------

export interface Cleaned {
  value: string;
  /** what was changed, for the "fixed before upload" list */
  note: string | null;
}

function clean(value: string, allowed: RegExp, max: number, what: string): Cleaned {
  const kept = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split("")
    .map((ch) => (allowed.test(ch) ? ch : ch === "." || ch === "," ? "" : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const cut = kept.length > max ? kept.slice(0, max).trim() : kept;
  const notes: string[] = [];
  const removed = [...new Set(value.split("").filter((ch) => !allowed.test(ch) && ch !== " "))];
  if (removed.length) notes.push(`removed ${removed.map((c) => `"${c}"`).join(" ")}`);
  if (cut.length < kept.length) notes.push(`cut to ${max} characters`);
  return { value: cut, note: notes.length ? `${what}: ${notes.join(", ")}` : null };
}

/** Name line 1: letters, numbers, spaces, - # ( ) & ' — at most 40. */
export const cleanName1 = (v: string, what = "name") => clean(v, /[A-Za-z0-9 \-#()&']/, 40, what);
/** Name line 2 also allows / and %. */
export const cleanName2 = (v: string, what = "name line 2") =>
  clean(v, /[A-Za-z0-9 \-#()&'/%]/, 40, what);
/** Address: letters, numbers, spaces, - and / — at most 35. */
export const cleanAddress = (v: string, what = "address") => clean(v, /[A-Za-z0-9 \-/]/, 35, what);
/** City: letters and spaces — at most 40. */
export const cleanCity = (v: string, what = "city") => clean(v, /[A-Za-z ]/, 40, what);

export function cleanZip(v: string): Cleaned {
  const digits = v.replace(/\D/g, "");
  return { value: digits, note: digits !== v.trim() && v.trim() ? `ZIP: kept the digits` : null };
}

/** Dollars with two decimals, never scientific notation. */
export function amount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export interface RowProblem {
  payee: string;
  form: IrisForm;
  /** a required value that is missing or cannot be made valid; the row will not upload until fixed */
  missing: string[];
  /** values changed to fit the guidelines */
  fixed: string[];
}

function recipientTinType(tin: Tin, decision: Decision): TinType {
  if (tin.type) return tin.type;
  return decision.entity.class === "not_corporation" &&
    /individual|sole/i.test(decision.entity.label ?? "")
    ? "SSN"
    : "EIN";
}

function rowValues(
  form: IrisForm,
  year: Year,
  payer: Payer | null,
  info: PayeeInfo,
  decision: Decision,
): { values: Partial<Record<Key, string>>; problem: RowProblem } {
  const fixed: string[] = [];
  const missing: string[] = [];
  const take = (c: Cleaned) => {
    if (c.note) fixed.push(c.note);
    return c.value;
  };
  const v: Partial<Record<Key, string>> = { form_type: form, tax_year: String(year) };

  if (payer) {
    v.payer_tin_type = payer.tinType;
    if (payer.tin) v.payer_tin = formatTin(payer.tin, payer.tinType);
    v.payer_name_type = "B";
    v.payer_name1 = take(cleanName1(payer.name, "payer name"));
    v.payer_name2 = take(cleanName2(payer.name2, "payer name line 2"));
    v.payer_country = payer.country;
    v.payer_address1 = take(cleanAddress(payer.address1, "payer address"));
    v.payer_address2 = take(cleanAddress(payer.address2, "payer address line 2"));
    v.payer_city = take(cleanCity(payer.city, "payer city"));
    v.payer_state = payer.state.toUpperCase();
    v.payer_zip = take(cleanZip(payer.zip));
    if (payer.phone) {
      v.payer_phone_type = "D";
      v.payer_phone = payer.phone.replace(/\D/g, "");
    }
  }

  // Recipient: name type B, the legal name on line 1 and a DBA or the LLC's name on line 2, as
  // Publication 1099 sets out for sole proprietors and single-member LLCs.
  if (info.tin) {
    const t = recipientTinType(info.tin, decision);
    v.recipient_tin_type = t;
    v.recipient_tin = formatTin(info.tin, t);
  }
  v.recipient_name_type = "B";
  v.recipient_name1 = take(cleanName1(info.name, "recipient name"));
  v.recipient_name2 = take(cleanName2(info.dba ?? "", "recipient name line 2"));
  v.recipient_country = (info.address.country || "US")
    .toUpperCase()
    .replace(/^USA$|^UNITED STATES.*$/, "US");
  v.recipient_address1 = take(cleanAddress(info.address.line1, "recipient address"));
  v.recipient_address2 = take(cleanAddress(info.address.line2, "recipient address line 2"));
  v.recipient_city = take(cleanCity(info.address.city, "recipient city"));
  v.recipient_state = info.address.state.trim().toUpperCase();
  v.recipient_zip = take(cleanZip(info.address.zip));
  v.second_tin_notice = "N";
  if (info.withheldCents > 0) v.box4_withheld = amount(info.withheldCents);

  if (form === "1099-NEC") {
    const line = decision.forms.find((f) => f.form === "1099-NEC")!;
    v.nec_box1 = amount(line.cents);
    v.nec_box2 = "N";
  } else {
    v.fatca = "N";
    v.misc_box7 = "N";
    for (const line of decision.forms.filter((f) => f.form === "1099-MISC")) {
      const key = `misc_box${line.box}` as Key;
      v[key] = amount(line.cents);
    }
  }

  if (!payer) missing.push("payer (pass --payer payer.json)");
  else {
    if (!payer.tin) missing.push("payer TIN");
    if (!v.payer_name1) missing.push("payer name");
    if (!v.payer_address1 || !v.payer_city || !v.payer_state || !v.payer_zip)
      missing.push("payer address");
  }
  if (!info.tin) missing.push("recipient TIN (from the W-9)");
  if (!v.recipient_address1) missing.push("recipient address line 1");
  if (!v.recipient_city) missing.push("recipient city");
  if (v.recipient_country === "US") {
    if (!/^[A-Z]{2}$/.test(v.recipient_state ?? "")) missing.push("recipient state (2 letters)");
    if (![5, 9, 12].includes((v.recipient_zip ?? "").length))
      missing.push("recipient ZIP (5 or 9 digits)");
  }
  return { values: v, problem: { payee: info.name, form, missing, fixed } };
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export interface IrisFile {
  path: string;
  form: IrisForm;
  records: number;
  batch: number;
  of: number;
}

export interface IrisPlan {
  layout: string;
  layoutNote: string;
  headerSource: Partial<Record<IrisForm, string>>;
  batchSize: number;
  files: IrisFile[];
  problems: RowProblem[];
  /** template columns that matched nothing we write, per form */
  unmatchedTemplateColumns: Partial<Record<IrisForm, string[]>>;
}

/** A template downloaded from the portal: its header row, and which form it is for. */
export function readTemplate(text: string): { form: IrisForm; headers: string[] } {
  const header = parseCsv(text)[0] ?? [];
  const joined = header.map(norm).join("|");
  const form: IrisForm | null = /nonemployee/.test(joined)
    ? "1099-NEC"
    : /\brents\b/.test(joined)
      ? "1099-MISC"
      : null;
  if (!form)
    throw new Error(
      "the template's header row has neither a Nonemployee Compensation nor a Rents column; pass the 1099-NEC or 1099-MISC template downloaded from the IRIS Taxpayer Portal",
    );
  return { form, headers: header };
}

const strip = (h: string) => norm(h.replace(/\*/g, ""));

export function layoutNote(year: Year): string {
  return year === LAYOUT_YEAR
    ? "TY2025 layout, from the IRS's TY2025 template formatting guidelines (updated 14 Jan 2026)."
    : `TY2025 layout with Tax Year ${year}: the IRS had not posted a TY${year} template when this version was released (latest: TY2025, updated 14 Jan 2026), and the December 2026 forms add boxes 1b–1d to the 1099-NEC and 13a, 13b and 14 to the 1099-MISC. Check these files against the TY${year} template in the portal before uploading, or rerun with --template.`;
}

export function planIris(
  assessment: Assessment,
  payees: ReadonlyMap<string, PayeeInfo>,
  payer: Payer | null,
  templates: readonly { form: IrisForm; headers: string[] }[] = [],
): { plan: IrisPlan; rows: Record<IrisForm, string[][]>; header: Record<IrisForm, string[]> } {
  const problems: RowProblem[] = [];
  const rows: Record<IrisForm, string[][]> = { "1099-NEC": [], "1099-MISC": [] };
  const header = {} as Record<IrisForm, string[]>;
  const unmatched: Partial<Record<IrisForm, string[]>> = {};
  const headerSource: Partial<Record<IrisForm, string>> = {};

  const order: Record<IrisForm, Key[]> = { "1099-NEC": [], "1099-MISC": [] };
  for (const form of ["1099-NEC", "1099-MISC"] as const) {
    const t = templates.find((x) => x.form === form);
    if (t) {
      const byName = new Map(LAYOUTS[form].map(([h, k]) => [strip(h), k] as const));
      header[form] = t.headers;
      order[form] = t.headers.map((h) => byName.get(strip(h)) ?? ("" as Key));
      unmatched[form] = t.headers.filter((h) => !byName.has(strip(h)));
      headerSource[form] = "the template you passed with --template";
    } else {
      header[form] = LAYOUTS[form].map(([h]) => h);
      order[form] = LAYOUTS[form].map(([, k]) => k);
      headerSource[form] = "the field names in the IRS TY2025 template formatting guidelines";
    }
  }

  for (const d of assessment.decisions) {
    if (d.status !== "file") continue;
    const info = payees.get(d.payee)!;
    for (const form of ["1099-NEC", "1099-MISC"] as const) {
      if (!d.forms.some((f) => f.form === form)) continue;
      const { values, problem } = rowValues(form, assessment.year, payer, info, d);
      if (problem.missing.length || problem.fixed.length) problems.push(problem);
      rows[form].push(order[form].map((k) => (k ? (values[k] ?? "") : "")));
    }
  }

  const files: IrisFile[] = [];
  for (const form of ["1099-NEC", "1099-MISC"] as const) {
    const all = rows[form];
    const of = Math.ceil(all.length / BATCH_SIZE);
    for (let b = 0; b < of; b++)
      files.push({
        path: fileName(form, assessment.year, b + 1, of),
        form,
        records: Math.min(BATCH_SIZE, all.length - b * BATCH_SIZE),
        batch: b + 1,
        of,
      });
  }
  return {
    plan: {
      layout: `TY${LAYOUT_YEAR}`,
      layoutNote: layoutNote(assessment.year),
      headerSource,
      batchSize: BATCH_SIZE,
      files,
      problems,
      unmatchedTemplateColumns: unmatched,
    },
    rows,
    header,
  };
}

export function fileName(form: IrisForm, year: number, batch: number, of: number): string {
  const layout = year === LAYOUT_YEAR ? "" : `_ty${LAYOUT_YEAR}-layout`;
  return `${form}_${year}${layout}_batch-${String(batch).padStart(2, "0")}-of-${String(of).padStart(2, "0")}.csv`;
}

/** Write the batches and LAYOUT.txt into `dir`; returns the files with their full paths. */
export function writeIris(
  dir: string,
  planned: ReturnType<typeof planIris>,
  disclaimer: string,
): IrisFile[] {
  const { plan, rows, header } = planned;
  if (plan.files.length === 0) return [];
  mkdirSync(dir, { recursive: true });
  const written: IrisFile[] = [];
  for (const f of plan.files) {
    const start = (f.batch - 1) * BATCH_SIZE;
    const body = rows[f.form].slice(start, start + BATCH_SIZE);
    const full = path.join(dir, f.path);
    writeFileSync(full, toCsv([header[f.form], ...body]), { mode: 0o600 });
    written.push({ ...f, path: full });
  }
  const lines = [
    "iris-1099: IRIS Taxpayer Portal CSVs",
    disclaimer,
    "",
    plan.layoutNote,
    `Header row: ${Object.entries(plan.headerSource)
      .map(([form, src]) => `${form} from ${src}`)
      .join("; ")}.`,
    `At most ${plan.batchSize} records per file, the limit in the IRS's IRIS FAQ.`,
    "These files hold full TINs. They were written with owner-only permissions; keep them that way",
    "and delete them once the forms are filed.",
    "",
    "Upload: IRIS Taxpayer Portal > Upload CSV with Form Data, one form type per file.",
  ];
  writeFileSync(path.join(dir, "LAYOUT.txt"), lines.join("\n") + "\n");
  return written;
}
