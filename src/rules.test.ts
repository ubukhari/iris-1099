import { describe, expect, it } from "vitest";
import { defaultYear, RULES, YEARS } from "./rules.js";
import { CITATIONS, cite, SAME_IN_2025, SOURCES, type CitationId } from "./sources.js";

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

describe("each year's thresholds are the ones its IRS sentence states", () => {
  it("1099-NEC: $600 for 2025 payments, $2,000 for 2026 (box 1, then box 1a)", () => {
    expect(RULES[2025].necThreshold).toBe(600);
    expect(RULES[2026].necThreshold).toBe(2000);
    for (const y of YEARS) {
      const r = RULES[y];
      const quote = CITATIONS[r.necCite].quote;
      expect(quote.toLowerCase()).toContain(`at least ${dollars(r.necThreshold)}`);
      expect(quote).toContain(`(box ${r.necBox})`);
      expect(SOURCES[CITATIONS[r.necCite].source].title).toContain(
        y === 2025 ? "Rev. April 2025" : "Rev. December 2026",
      );
    }
  });

  it("1099-MISC: every box's threshold appears in the sentence it cites", () => {
    for (const y of YEARS)
      for (const m of RULES[y].misc)
        expect(CITATIONS[m.cite].quote, `${y} box ${m.box}`).toContain(dollars(m.threshold));
  });

  it("royalties stay at $10 and attorneys' gross proceeds at $600 in both years", () => {
    for (const y of YEARS) {
      expect(RULES[y].misc.find((m) => m.kind === "royalties")?.threshold).toBe(10);
      expect(RULES[y].misc.find((m) => m.kind === "attorney_proceeds")?.threshold).toBe(600);
    }
    expect(RULES[2026].misc.find((m) => m.kind === "rents")?.threshold).toBe(2000);
  });

  it("due dates are the next business day after a weekend 31 January", () => {
    expect(weekday("2026-01-31")).toBe("Saturday");
    expect(weekday(RULES[2025].due.nec)).toBe("Monday");
    expect(RULES[2025].due.nec).toBe("2026-02-02");
    expect(weekday("2027-01-31")).toBe("Sunday");
    expect(RULES[2026].due.nec).toBe("2027-02-01");
    expect(weekday(RULES[2026].due.nec)).toBe("Monday");
    for (const y of YEARS)
      expect(["Saturday", "Sunday"]).not.toContain(weekday(RULES[y].due.miscElectronic));
  });

  it("the default year is this year from July, last year before", () => {
    expect(defaultYear(new Date("2026-10-08T12:00:00Z"))).toBe(2026);
    expect(defaultYear(new Date("2027-01-20T12:00:00Z"))).toBe(2026);
    expect(defaultYear(new Date("2026-03-01T12:00:00Z"))).toBe(2025);
  });
});

describe("citations", () => {
  it("every citation names a source we read, with the date we read it", () => {
    for (const [id, c] of Object.entries(CITATIONS)) {
      const s = SOURCES[c.source];
      expect(s, id).toBeDefined();
      expect(s.url).toMatch(/^https:\/\/www\.irs\.gov\//);
      expect(s.seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.quote.length, id).toBeGreaterThan(30);
    }
  });

  it("a 2025 run cites the April 2025 revision for the sentences both revisions share", () => {
    for (const id of SAME_IN_2025) {
      expect(cite(id, 2025).source).toContain("Rev. April 2025");
      expect(cite(id, 2026).source).toContain("Rev. December 2026");
    }
    // the year-specific ones are never swapped
    for (const id of ["nec-2026", "misc-2000-2026", "threshold-change"] as CitationId[])
      expect(SAME_IN_2025.has(id)).toBe(false);
  });

  it("FIRE's last day and IRIS-only date are the IRS's", () => {
    expect(CITATIONS["fire-last-day"].quote).toContain("Nov. 19, 2026, at 3 p.m. ET");
    expect(CITATIONS["iris-only"].quote).toContain("after Jan. 1, 2027");
    expect(CITATIONS["iris-100"].quote).toContain("up to 100 records");
  });
});
