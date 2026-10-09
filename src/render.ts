/**
 * The text a person reads: who needs which form and why, what to check, the missing W-9s, the
 * IRIS files, the dates, and every IRS sentence applied, numbered. Drawn only from the Report, so
 * it cannot say anything `--json` does not.
 */
import path from "node:path";
import type { Report } from "./report.js";
import { redactTins } from "./tin.js";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const day = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));
const refs = (ns: readonly number[]) => (ns.length ? ` [${ns.join("][")}]` : "");

function wrap(text: string, width: number, indent: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width - indent.length) {
      out.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(indent + line);
  return out;
}

export interface RenderOptions {
  /** the line about the hosted season record; off with --quiet */
  waitlist: boolean;
  width?: number;
  /** paths under this folder are shown relative to it */
  cwd?: string;
}

export function renderText(r: Report, opts: RenderOptions): string {
  const W = opts.width ?? 96;
  const show = (p: string) => {
    if (!opts.cwd || !path.isAbsolute(p)) return p;
    const rel = path.relative(opts.cwd, p);
    return rel.startsWith("..") ? p : rel;
  };
  const out: string[] = [];
  const s = r.summary;
  out.push(
    `iris-1099 ${r.version} · ${r.year} payments · ${s.payees} payees in ${show(r.input.file)}`,
    r.disclaimer,
    "",
    ...wrap(
      `Thresholds for ${r.year} payments: 1099-NEC ${r.thresholds.nec}; 1099-MISC ${r.thresholds.misc
        .map((m) => `${m.what} ${m.at_least}`)
        .join(", ")}.`,
      W,
      "",
    ),
    "",
  );

  const file = r.payees.filter((p) => p.status === "file");
  const none = r.payees.filter((p) => p.status === "no_form");
  const nameW = Math.min(34, Math.max(12, ...r.payees.map((p) => p.name.length)));

  out.push(`Needs a 1099 (${file.length})`);
  for (const p of file) {
    for (const [i, f] of p.forms.entries()) {
      const who = i === 0 ? p.name.padEnd(nameW) : "".padEnd(nameW);
      const tin = i === 0 ? `  ${p.tin ? `TIN ${p.tin}` : "no TIN on file"}` : "";
      out.push(`  ${who}  ${`${f.form} box ${f.box}`.padEnd(18)} ${f.amount.padStart(12)}${tin}`);
      out.push(...wrap(f.reason + refs(f.cite), W, "      "));
    }
    for (const x of p.not_filed) out.push(...wrap(`also: ${x.reason}${refs(x.cite)}`, W, "      "));
    for (const c of p.checks) out.push(...wrap(`check: ${c.text}${refs(c.cite)}`, W, "      "));
  }
  out.push("", `No 1099 from you (${none.length})`);
  for (const p of none) {
    const [first, ...rest] = p.not_filed;
    out.push(`  ${p.name.padEnd(nameW)}  ${p.total_paid.padStart(12)}`);
    for (const x of [first, ...rest].filter((x) => x !== undefined))
      out.push(...wrap(x.reason + refs(x.cite), W, "      "));
  }

  out.push("", `Missing W-9s (${r.missing_w9.length})`);
  if (r.missing_w9.length === 0) out.push("  none among the payees who need a form");
  else {
    out.push(
      ...wrap(
        "Request a W-9 from each before you file; the 1099 needs its TIN. Without one, backup withholding at 24% applies to further payments.",
        W,
        "  ",
      ),
    );
    for (const name of r.missing_w9) out.push(`  - ${name}`);
  }

  out.push("", "IRIS Taxpayer Portal CSVs");
  out.push(...wrap(r.iris.layout_note, W, "  "));
  if (r.iris.files.length === 0) out.push("  none: no payee needs a form");
  for (const f of r.iris.files)
    out.push(`  ${show(f.file)}  ${f.records} record${f.records === 1 ? "" : "s"}`);
  if (r.iris.files.length && !r.iris.written_to) out.push("  (not written: --no-files)");
  if (r.iris.fix_before_upload.length) {
    out.push("  Fix before upload (the portal rejects a row without these):");
    for (const p of r.iris.fix_before_upload)
      out.push(...wrap(`${p.payee} (${p.form}): ${p.missing.join("; ")}`, W, "    - "));
  }
  if (r.iris.cleaned.length) {
    out.push("  Changed to fit the IRS formatting guidelines:");
    for (const p of r.iris.cleaned)
      out.push(...wrap(`${p.payee}: ${p.changes.join("; ")}`, W, "    - "));
  }

  out.push("", "Dates");
  for (const d of r.deadlines)
    out.push(...wrap(`${day(d.date)}: ${d.what}${refs(d.cite)}`, W, "  "));

  const notes: string[] = [];
  if (r.input.payments_assumed_services)
    notes.push(
      `${r.input.payments_assumed_services} payments had no account or category saying what they were for and were counted as services; name the column with --map category=… if there is one.`,
    );
  if (r.input.other_year_payments)
    notes.push(`${r.input.other_year_payments} payments dated outside ${r.year} were left out.`);
  if (r.input.skipped_rows)
    notes.push(`${r.input.skipped_rows} rows had no payee or no amount and were skipped.`);
  if (notes.length) {
    out.push("", "Notes");
    for (const n of notes) out.push(...wrap(n, W, "  "));
  }

  out.push("", `IRS sentences applied (read ${day(r.citations[0]?.seen ?? "2026-10-08")})`);
  for (const c of r.citations) {
    out.push(...wrap(`[${c.n}] "${c.quote}"`, W, "  "));
    out.push(`      ${c.source}, ${c.url}`);
  }
  out.push("", r.disclaimer);

  if (opts.waitlist) {
    out.push("");
    out.push(
      ...wrap(`${r.waitlist.offer} ${r.waitlist.status} Count me in: ${r.waitlist.url}`, W, ""),
    );
  }
  // the last guard: nothing printed holds a full TIN
  return redactTins(out.join("\n")) + "\n";
}
