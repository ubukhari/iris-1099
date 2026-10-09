/**
 * One run, start to finish: read the report, decide each payee, plan the IRIS files and (unless
 * told not to) write them. Shared by the CLI and the MCP tool; neither opens a network connection.
 */
import { readFileSync } from "node:fs";
import { assess } from "./decide.js";
import { InputError, readReport } from "./input.js";
import { planIris, readPayer, readTemplate, writeIris, type Payer } from "./iris.js";
import { buildReport, type Report } from "./report.js";
import { isYear, YEARS } from "./rules.js";
import { DISCLAIMER } from "./sources.js";

export interface CheckOptions {
  /** what the report calls the file, for the output */
  label: string;
  text: string;
  year: number;
  map?: string;
  payer?: Payer | null;
  templates?: string[];
  /** where to write the IRIS CSVs; null writes nothing */
  outDir: string | null;
}

export function checkYear(year: number): asserts year is (typeof YEARS)[number] {
  if (!isYear(year))
    throw new InputError(
      "UNSUPPORTED_YEAR",
      year > 2026
        ? `${year}: the IRS says the $2,000 threshold "may be adjusted for inflation beginning in calendar year 2027" and has not published the ${year} amounts`
        : `${year}: only 2025 and 2026 payments are covered`,
      `Use --year ${YEARS.join(" or --year ")}.`,
    );
}

export function runCheck(opts: CheckOptions): Report {
  checkYear(opts.year);
  const parsed = readReport(opts.text, opts.map);
  const assessment = assess(parsed, opts.year);
  const templates = (opts.templates ?? []).map((t) => {
    try {
      return readTemplate(readFileSync(t, "utf8"));
    } catch (err) {
      throw new InputError(
        "BAD_TEMPLATE",
        `${t}: ${err instanceof Error ? err.message : String(err)}`,
        "Pass the CSV template downloaded from the IRIS Taxpayer Portal (Upload CSV with Form Data).",
      );
    }
  });
  const planned = planIris(assessment, parsed.payees, opts.payer ?? null, templates);
  const files = opts.outDir ? writeIris(opts.outDir, planned, DISCLAIMER) : null;
  return buildReport(
    opts.label,
    parsed,
    assessment,
    planned.plan,
    opts.outDir && files ? { dir: opts.outDir, files } : null,
  );
}

export function loadPayer(file: string): Payer {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new InputError(
      "BAD_PAYER",
      `${file}: ${err instanceof Error ? err.message : String(err)}`,
      'Pass a JSON file like {"name":"…","tin":"12-3456789","address1":"…","city":"…","state":"TX","zip":"75001"}.',
    );
  }
  return readPayer(json);
}
