import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { INSTALL } from "./install.js";
import { main, type Io } from "./main.js";
import type { Report } from "./report.js";
import { DISCLAIMER } from "./sources.js";
import { SYNTHETIC_PAYER, syntheticCsv } from "./synthetic.js";
import { WAITLIST_CLI_URL, WAITLIST_OFFER, WAITLIST_PRICE } from "./waitlist.js";

const tmp = mkdtempSync(path.join(tmpdir(), "iris-1099-main-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function run(argv: string[], cwd = tmp): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: Io = {
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
    cwd,
    now: new Date("2026-10-08T12:00:00Z"),
  };
  const code = await main(argv, io);
  return { code, out, err };
}

/** Every full synthetic TIN, in every way it could be printed. */
const TINS = [...syntheticCsv(2026).matchAll(/\b(\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b/g)].map(
  (m) => m[1]!,
);

function expectNoFullTin(text: string) {
  expect(TINS.length).toBeGreaterThan(5);
  for (const t of [...TINS, SYNTHETIC_PAYER.tin]) {
    expect(text).not.toContain(t);
    expect(text).not.toContain(t.replace(/-/g, ""));
  }
}

describe("--help", () => {
  it("shows the one command, the flags and what it sends", async () => {
    const { code, out } = await run(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain(`${INSTALL} <report.csv>`);
    for (const flag of ["--json", "--year", "--demo", "--payer", "--map", "--template", "--out"])
      expect(out).toContain(flag);
    expect(out).toContain("makes no network");
    expect(out).toContain(DISCLAIMER);
  });
});

describe("a report on disk", () => {
  const file = path.join(tmp, "payments.csv");
  writeFileSync(file, syntheticCsv(2026));
  writeFileSync(path.join(tmp, "payer.json"), JSON.stringify(SYNTHETIC_PAYER));

  it("prints the decisions, the IRS sentences, the disclaimer and the waitlist, and no full TIN", async () => {
    const { code, out } = await run(["payments.csv", "--year", "2026", "--payer", "payer.json"]);
    expect(code).toBe(0);
    expect(out.split("\n")[1]).toBe(DISCLAIMER);
    expect(
      out
        .trimEnd()
        .split("\n")
        .filter((l) => l === DISCLAIMER),
    ).toHaveLength(2);
    expect(out).toContain("Needs a 1099 (9)");
    expect(out).toContain("Missing W-9s (2)");
    expect(out).toContain('[1] "File Form 1099-NEC, Nonemployee Compensation');
    expect(out).toContain("https://www.irs.gov/instructions/i1099mec");
    expect(out).toContain("19 Nov 2026: FIRE takes its last filing");
    expect(out).toContain(WAITLIST_OFFER.split(" — ")[0]!);
    expect(out).toContain(WAITLIST_PRICE);
    expect(out).toContain(WAITLIST_CLI_URL);
    expectNoFullTin(out);
    const files = readdirSync(path.join(tmp, "iris-1099-2026"));
    expect(files.sort()).toEqual([
      "1099-MISC_2026_ty2025-layout_batch-01-of-01.csv",
      "1099-NEC_2026_ty2025-layout_batch-01-of-01.csv",
      "LAYOUT.txt",
    ]);
  });

  it("--json: the same result as data, TINs masked", async () => {
    const { code, out } = await run(["payments.csv", "--json", "--no-files"]);
    expect(code).toBe(0);
    const r = JSON.parse(out) as Report;
    expect(r.year).toBe(2026);
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.summary).toMatchObject({ payees: 14, need_a_form: 9, no_form: 5, missing_w9: 2 });
    expect(r.payees.find((p) => p.name === "Osei & Park LLP")?.tin).toBe("**-***1005");
    expect(r.iris.written_to).toBeNull();
    for (const p of r.payees)
      for (const f of p.forms) for (const n of f.cite) expect(r.citations[n - 1]).toBeDefined();
    expect(r.waitlist.url).toBe(WAITLIST_CLI_URL);
    expectNoFullTin(out);
  });

  it("--quiet leaves out the waitlist line, never the disclaimer", async () => {
    const { out } = await run(["payments.csv", "--quiet", "--no-files"]);
    expect(out).not.toContain(WAITLIST_CLI_URL);
    expect(out).toContain(DISCLAIMER);
  });
});

describe("--demo", () => {
  it("runs on synthetic vendors, labelled, and writes into the folder it names", async () => {
    const out = path.join(tmp, "demo");
    const r = await run(["--demo", "--out", out]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toMatch(/^SYNTHETIC demo data/);
    expect(readdirSync(out)).toContain("synthetic-vendor-payments-2026.csv");
    expectNoFullTin(r.out);
  });

  it("--year 2025 applies $600", async () => {
    const r = await run(["--demo", "--year", "2025", "--json", "--no-files"]);
    const report = JSON.parse(r.out) as Report;
    expect(report.thresholds.nec).toBe("$600 (box 1)");
    expect(report.summary.need_a_form).toBe(11);
    expect(report.citations[0]?.source).toContain("Rev. April 2025");
  });
});

describe("errors carry a code, the cause and the fix", () => {
  it("a year with no published rules", async () => {
    const r = await run(["--demo", "--year", "2027"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("may be adjusted for inflation beginning in calendar year 2027");
    expect(r.err).toContain("UNSUPPORTED_YEAR");
  });
  it("--json errors are JSON", async () => {
    const r = await run(["nope.csv", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({
      error: { code: "FILE_NOT_FOUND", retryable: false },
    });
  });
  it("no file", async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`${INSTALL} --demo`);
  });
  it("an unknown flag", async () => {
    expect((await run(["--frobnicate"])).code).toBe(2);
  });
});

describe("the IRIS files hold what the screen never shows", () => {
  it("full TINs are in the CSV, masked on screen", async () => {
    const dir = path.join(tmp, "iris-1099-2026");
    const nec = readdirSync(dir).find((f) => f.startsWith("1099-NEC"))!;
    expect(readFileSync(path.join(dir, nec), "utf8")).toContain("00-0001005");
  });
});
