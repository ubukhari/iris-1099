/**
 * The command line.
 *
 *   iris-1099 <report.csv> [--year 2026] [--payer payer.json] [--out dir] [--json]
 *   iris-1099 --demo [--year 2025|2026] [--json]
 *   iris-1099 mcp
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkYear, loadPayer, runCheck } from "./check.js";
import { FIELDS, InputError } from "./input.js";
import { INSTALL } from "./install.js";
import { readPayer, type Payer } from "./iris.js";
import { serveStdio } from "./mcp.js";
import { renderText } from "./render.js";
import { defaultYear, YEARS } from "./rules.js";
import { DISCLAIMER } from "./sources.js";
import { SYNTHETIC_LABEL, SYNTHETIC_PAYER, syntheticCsv } from "./synthetic.js";
import { version } from "./version.js";
import { PAGES_URL } from "./waitlist.js";

export function help(): string {
  return `iris-1099 ${version()}: who needs a 1099 for 2025 or 2026 payments, and IRIS-ready CSVs, locally.
${DISCLAIMER}

Usage
  ${INSTALL} <report.csv> [options]
  ${INSTALL} --demo [--year 2025|2026]
  ${INSTALL} mcp

The report is a QuickBooks or Xero 1099 or vendor-payments export, or any CSV with a payee column
and an amount column (one row per payment), or a payee column and one column per 1099 box.

Options
  --year <${YEARS.join("|")}>     the year the payments were made (default: this year from July on,
                        otherwise last year). 2025: $600 thresholds. 2026: $2,000.
  --payer <file.json>   your business, for the IRIS files' payer columns:
                        {"name","tin","tin_type":"EIN"|"SSN","address1","city","state","zip","phone"}
  --map <spec>          which header is which, when the names differ:
                        --map name=Supplier,amount="Paid out",method="Paid via"
                        fields: ${FIELDS.join(", ")}
  --template <file>     a CSV template downloaded from the IRIS Taxpayer Portal; its exact header
                        row is used (repeat for the 1099-NEC and the 1099-MISC)
  --out <dir>           where the IRIS CSVs go (default ./iris-1099-<year>)
  --no-files            decide and report, write nothing
  --json                the whole result as JSON on stdout
  --demo                run on synthetic vendors (invented; writes to a temp folder)
  --quiet               leave out the line about the hosted season record
  -h, --help            this text
  -v, --version         the version

What it reads and sends
  It reads the file you name and writes the IRIS CSVs where --out says. It makes no network
  request and calls no LLM. TINs are written only into the IRIS CSVs on your disk (owner-only
  permissions) and are never printed: everything shown is the last four digits.

Guides: ${PAGES_URL}
`;
}

interface Args {
  file: string | null;
  year: number | null;
  payer: string | null;
  map: string | undefined;
  templates: string[];
  out: string | null;
  noFiles: boolean;
  json: boolean;
  demo: boolean;
  quiet: boolean;
  mcp: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    file: null,
    year: null,
    payer: null,
    map: undefined,
    templates: [],
    out: null,
    noFiles: false,
    json: false,
    demo: false,
    quiet: false,
    mcp: false,
    help: false,
    version: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--"))
      throw new InputError("BAD_ARGS", `${flag} needs a value`, `See ${INSTALL} --help.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg];
    const take = (): string => {
      if (inline !== undefined) return inline;
      const v = value(i, flag!);
      i++;
      return v;
    };
    switch (flag) {
      case "--year": {
        const v = take();
        if (!/^\d{4}$/.test(v))
          throw new InputError(
            "BAD_ARGS",
            `--year ${v} is not a year`,
            `Use --year ${YEARS.join(" or ")}.`,
          );
        a.year = Number(v);
        break;
      }
      case "--payer":
        a.payer = take();
        break;
      case "--map":
        a.map = take();
        break;
      case "--template":
        a.templates.push(take());
        break;
      case "--out":
        a.out = take();
        break;
      case "--no-files":
        a.noFiles = true;
        break;
      case "--json":
        a.json = true;
        break;
      case "--demo":
      case "demo":
        a.demo = true;
        break;
      case "--quiet":
      case "-q":
        a.quiet = true;
        break;
      case "-h":
      case "--help":
      case "help":
        a.help = true;
        break;
      case "-v":
      case "--version":
        a.version = true;
        break;
      case "mcp":
        if (a.file === null && i === 0) {
          a.mcp = true;
          break;
        }
        a.file = arg;
        break;
      default:
        if (arg.startsWith("-"))
          throw new InputError("BAD_ARGS", `unknown option ${arg}`, `See ${INSTALL} --help.`);
        if (a.file !== null)
          throw new InputError(
            "BAD_ARGS",
            `two report files given (${a.file}, ${arg})`,
            "Run once per report, or combine the exports into one CSV.",
          );
        a.file = arg;
    }
  }
  return a;
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  now: Date;
}

const defaultIo = (): Io => ({
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  now: new Date(),
});

function fail(io: Io, json: boolean, err: InputError): number {
  if (json)
    io.stdout(
      JSON.stringify(
        { error: { code: err.code, cause: err.cause_, fix: err.fix, retryable: false } },
        null,
        2,
      ) + "\n",
    );
  else io.stderr(`iris-1099: ${err.cause_}\n  fix: ${err.fix}\n  (${err.code})\n`);
  return err.code === "BAD_ARGS" || err.code === "UNSUPPORTED_YEAR" ? 2 : 1;
}

export async function main(argv: readonly string[], io: Io = defaultIo()): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof InputError) return fail(io, argv.includes("--json"), err);
    throw err;
  }
  if (args.help) {
    io.stdout(help());
    return 0;
  }
  if (args.version) {
    io.stdout(version() + "\n");
    return 0;
  }
  if (args.mcp) {
    await serveStdio({ cwd: io.cwd });
    return 0;
  }
  try {
    const year = args.year ?? defaultYear(io.now);
    checkYear(year);
    let text: string;
    let label: string;
    let payer: Payer | null = args.payer ? loadPayer(path.resolve(io.cwd, args.payer)) : null;
    let outDir: string | null;
    if (args.demo) {
      text = syntheticCsv(year);
      const dir = args.out
        ? path.resolve(io.cwd, args.out)
        : mkdtempSync(path.join(tmpdir(), "iris-1099-demo-"));
      // the synthetic input sits next to the IRIS files, so the demo can be rerun on it
      const input = path.join(dir, `synthetic-vendor-payments-${year}.csv`);
      if (!args.noFiles) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(input, text);
        label = input;
      } else label = `synthetic-vendor-payments-${year}.csv`;
      payer ??= readPayer(SYNTHETIC_PAYER);
      outDir = args.noFiles ? null : dir;
    } else {
      if (!args.file)
        throw new InputError(
          "BAD_ARGS",
          "no report file given",
          `Run ${INSTALL} <report.csv>, or ${INSTALL} --demo to see it on synthetic vendors.`,
        );
      const file = path.resolve(io.cwd, args.file);
      try {
        text = readFileSync(file, "utf8");
      } catch {
        throw new InputError(
          "FILE_NOT_FOUND",
          `cannot read ${file}`,
          "Check the path and that the file is a CSV export.",
        );
      }
      label = args.file;
      outDir = args.noFiles ? null : path.resolve(io.cwd, args.out ?? `iris-1099-${year}`);
    }
    const report = runCheck({
      label,
      text,
      year,
      map: args.map,
      payer,
      templates: args.templates.map((t) => path.resolve(io.cwd, t)),
      outDir,
    });
    if (args.json) io.stdout(JSON.stringify(report, null, 2) + "\n");
    else {
      if (args.demo) io.stdout(`${SYNTHETIC_LABEL}\n\n`);
      io.stdout(renderText(report, { waitlist: !args.quiet, cwd: io.cwd }));
    }
    return 0;
  } catch (err) {
    if (err instanceof InputError) return fail(io, args.json, err);
    throw err;
  }
}
