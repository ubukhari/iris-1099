import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";
import { assess } from "./decide.js";
import { readReport } from "./input.js";
import {
  amount,
  BATCH_SIZE,
  cleanAddress,
  cleanCity,
  cleanName1,
  fileName,
  MISC_COLUMNS,
  NEC_COLUMNS,
  planIris,
  readPayer,
  readTemplate,
  writeIris,
} from "./iris.js";
import { SYNTHETIC_PAYER, syntheticCsv } from "./synthetic.js";

const tmp = mkdtempSync(path.join(tmpdir(), "iris-1099-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Spreadsheet column letters: A..Z, AA..AZ, BA.. */
const letter = (i: number) =>
  (i < 26 ? "" : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));

describe("layouts: the IRS TY2025 template formatting guidelines, column by column", () => {
  it("1099-NEC runs A–BB, 1099-MISC A–BL", () => {
    expect(letter(NEC_COLUMNS.length - 1)).toBe("BB");
    expect(letter(MISC_COLUMNS.length - 1)).toBe("BL");
  });

  it("the columns the guidelines letter sit at those letters", () => {
    const at = (cols: typeof NEC_COLUMNS, l: string) => cols.find((_c, i) => letter(i) === l)?.[0];
    expect(at(NEC_COLUMNS, "T")).toBe("Recipient TIN Type");
    expect(at(NEC_COLUMNS, "U")).toBe("Recipient Taxpayer ID Number");
    expect(at(NEC_COLUMNS, "AK")).toBe("2nd TIN Notice");
    expect(at(NEC_COLUMNS, "AL")).toBe("Box 1 - Nonemployee Compensation");
    expect(at(NEC_COLUMNS, "AO")).toBe("Box 4 - Federal income tax withheld");
    expect(at(NEC_COLUMNS, "AQ")).toBe("State 1");
    expect(at(MISC_COLUMNS, "AK")).toBe("FATCA Filing Requirements");
    expect(at(MISC_COLUMNS, "AM")).toBe("Box 1 - Rents");
    expect(at(MISC_COLUMNS, "AR")).toBe("Box 6 - Medical and health care payments");
    expect(at(MISC_COLUMNS, "AV")).toBe("Box 10 - Gross proceeds paid to an attorney");
    expect(at(MISC_COLUMNS, "AZ")).toBe("Combined Federal/State Filing (CF/SF)");
    expect(at(MISC_COLUMNS, "BA")).toBe("State 1");
  });
});

describe("cleaning to the guidelines' character sets", () => {
  it("names keep letters, numbers, spaces and - # ( ) & ', at most 40", () => {
    expect(cleanName1("Northwind Office Supply, Inc.")).toEqual({
      value: "Northwind Office Supply Inc",
      note: 'name: removed "," "."',
    });
    expect(cleanName1("Quill & Ledger (Copy) #2").value).toBe("Quill & Ledger (Copy) #2");
    expect(cleanName1("A".repeat(45)).value).toHaveLength(40);
  });
  it("addresses keep letters, numbers, spaces, - and /, at most 35; cities letters and spaces", () => {
    expect(cleanAddress("12 Example Wharf, Suite #3").value).toBe("12 Example Wharf Suite 3");
    expect(cleanCity("St. Louis").value).toBe("St Louis");
    expect(cleanCity("Coeur d'Alene").value).toBe("Coeur d Alene");
  });
  it("amounts have two decimals and never scientific notation", () => {
    expect(amount(104500000)).toBe("1045000.00");
    expect(amount(5)).toBe("0.05");
  });
});

describe("files", () => {
  const year = 2026 as const;
  const report = readReport(syntheticCsv(year));
  const assessment = assess(report, year);
  const payer = readPayer(SYNTHETIC_PAYER);

  it("one file per form, named for the year and the layout it uses", () => {
    expect(fileName("1099-NEC", 2026, 1, 1)).toBe("1099-NEC_2026_ty2025-layout_batch-01-of-01.csv");
    expect(fileName("1099-NEC", 2025, 2, 3)).toBe("1099-NEC_2025_batch-02-of-03.csv");
    const { plan } = planIris(assessment, report.payees, payer);
    expect(plan.files.map((f) => [f.form, f.records])).toEqual([
      ["1099-NEC", 6],
      ["1099-MISC", 3],
    ]);
    expect(plan.layoutNote).toMatch(/had not posted a TY2026 template/);
  });

  it("batches of at most 100 records", () => {
    expect(BATCH_SIZE).toBe(100);
    const lines = ["Vendor,Amount,Tax ID,Address,City,State,ZIP"];
    for (let i = 0; i < 250; i++)
      lines.push(
        `Synthetic Vendor ${i},2500,100-00-${String(i).padStart(4, "0")},1 Main St,Anytown,TX,75001`,
      );
    const r = readReport(lines.join("\n"));
    const planned = planIris(assess(r, 2026), r.payees, payer);
    expect(planned.plan.files.map((f) => f.records)).toEqual([100, 100, 50]);
    const written = writeIris(path.join(tmp, "many"), planned, "x");
    const rows = written.map((f) =>
      parseCsv(readFileSync(f.path, "utf8")).filter((row) => row.length > 1),
    );
    expect(rows.map((r) => r.length)).toEqual([101, 101, 51]);
  });

  it("rows carry full TINs in the IRS format; the files are owner-only", () => {
    const planned = planIris(assessment, report.payees, payer);
    const dir = path.join(tmp, "synthetic");
    const written = writeIris(dir, planned, "Prepared for your review, not tax advice.");
    const nec = parseCsv(readFileSync(written[0]!.path, "utf8"));
    const header = nec[0]!;
    const row = nec.find(
      (r) => r[header.indexOf("Recipient Business or Entity Name Line 1")] === "Osei & Park LLP",
    )!;
    const col = (h: string) => row[header.indexOf(h)];
    expect(col("Form Type")).toBe("1099-NEC");
    expect(col("Tax Year")).toBe("2026");
    expect(col("Payer Taxpayer ID Number")).toBe("00-0000100");
    expect(col("Recipient TIN Type")).toBe("EIN");
    expect(col("Recipient Taxpayer ID Number")).toBe("00-0001005");
    expect(col("Box 1 - Nonemployee Compensation")).toBe("6500.00");
    expect(col("2nd TIN Notice")).toBe("N");
    expect(statSync(written[0]!.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toContain("LAYOUT.txt");
    expect(readFileSync(path.join(dir, "LAYOUT.txt"), "utf8")).toContain(
      "Prepared for your review, not tax advice.",
    );
  });

  it("a row the portal would reject is listed with what is missing", () => {
    const { plan } = planIris(assessment, report.payees, null);
    const tern = plan.problems.find((p) => p.payee === "Tern Street Translation")!;
    expect(tern.missing).toEqual([
      "payer (pass --payer payer.json)",
      "recipient TIN (from the W-9)",
    ]);
  });

  it("a template from the portal sets the header row, matched by name, asterisks and case aside", () => {
    const header = NEC_COLUMNS.map(([h], i) => (i % 3 === 0 ? `${h.toUpperCase()}*` : h));
    header.push("A Column We Do Not Know");
    const t = readTemplate(toCsv([header]));
    expect(t.form).toBe("1099-NEC");
    const planned = planIris(assessment, report.payees, payer, [t]);
    expect(planned.header["1099-NEC"]).toEqual(header);
    expect(planned.plan.unmatchedTemplateColumns["1099-NEC"]).toEqual(["A Column We Do Not Know"]);
    const first = planned.rows["1099-NEC"][0]!;
    expect(first[0]).toBe("1099-NEC");
    expect(first.at(-1)).toBe("");
    expect(() => readTemplate("Foo,Bar\n")).toThrow(/neither/);
  });
});
