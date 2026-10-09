/**
 * The rules for one payment year, each with the IRS sentence it comes from (src/sources.ts).
 *
 * Only 2025 and 2026 are here. 2027's thresholds "may be adjusted for inflation beginning in
 * calendar year 2027", and the IRS has not said by how much, so a 2027 run is refused rather than
 * guessed at.
 */
import type { CitationId } from "./sources.js";

export const YEARS = [2025, 2026] as const;
export type Year = (typeof YEARS)[number];

export function isYear(n: number): n is Year {
  return (YEARS as readonly number[]).includes(n);
}

/** What a payment was for, as far as the 1099 boxes care. */
export type Kind =
  | "services"
  | "attorney_fees"
  | "attorney_proceeds"
  | "rents"
  | "royalties"
  | "other_income"
  | "medical"
  | "goods";

export const KINDS: readonly Kind[] = [
  "services",
  "attorney_fees",
  "attorney_proceeds",
  "rents",
  "royalties",
  "other_income",
  "medical",
  "goods",
];

export const KIND_LABEL: Readonly<Record<Kind, string>> = {
  services: "services",
  attorney_fees: "attorney fees",
  attorney_proceeds: "gross proceeds paid to an attorney",
  rents: "rents",
  royalties: "royalties",
  other_income: "other income",
  medical: "medical and health care",
  goods: "merchandise and similar items",
};

/** How it was paid. Card and payment-network payments are the card company's or network's to report. */
export type Method = "card" | "network" | "direct";

export type MiscBox = "rents" | "royalties" | "other_income" | "medical" | "attorney_proceeds";

export interface MiscRule {
  kind: MiscBox;
  /** the box on Form 1099-MISC */
  box: string;
  /** dollars; the payment must be at least this */
  threshold: number;
  cite: CitationId;
}

export interface YearRules {
  year: Year;
  /** at least this much NEC (services plus attorney fees) needs a 1099-NEC */
  necThreshold: number;
  /** "1" for 2025 forms, "1a" for the December 2026 revision */
  necBox: string;
  necCite: CitationId;
  misc: readonly MiscRule[];
  /** ISO dates: 1099-NEC to the IRS and to recipients; 1099-MISC to the IRS filed electronically */
  due: { nec: string; necNote: string; miscElectronic: string };
}

const MISC_2025: readonly MiscRule[] = [
  { kind: "rents", box: "1", threshold: 600, cite: "misc-600-2025" },
  { kind: "royalties", box: "2", threshold: 10, cite: "misc-royalties" },
  { kind: "other_income", box: "3", threshold: 600, cite: "misc-600-2025" },
  { kind: "medical", box: "6", threshold: 600, cite: "misc-600-2025" },
  { kind: "attorney_proceeds", box: "10", threshold: 600, cite: "misc-600-2025" },
];

const MISC_2026: readonly MiscRule[] = [
  { kind: "rents", box: "1", threshold: 2000, cite: "misc-2000-2026" },
  { kind: "royalties", box: "2", threshold: 10, cite: "misc-royalties" },
  { kind: "other_income", box: "3", threshold: 2000, cite: "misc-2000-2026" },
  { kind: "medical", box: "6", threshold: 2000, cite: "misc-2000-2026" },
  // attorneys' gross proceeds stayed at $600 (section 6045(f)); the December 2026 revision says so
  { kind: "attorney_proceeds", box: "10", threshold: 600, cite: "misc-attorney-2026" },
];

export const RULES: Readonly<Record<Year, YearRules>> = {
  2025: {
    year: 2025,
    necThreshold: 600,
    necBox: "1",
    necCite: "nec-2025",
    misc: MISC_2025,
    // 31 Jan 2026 is a Saturday
    due: {
      nec: "2026-02-02",
      necNote: "31 January 2026 is a Saturday, so the next business day",
      miscElectronic: "2026-03-31",
    },
  },
  2026: {
    year: 2026,
    necThreshold: 2000,
    necBox: "1a",
    necCite: "nec-2026",
    misc: MISC_2026,
    // 31 Jan 2027 is a Sunday
    due: {
      nec: "2027-02-01",
      necNote: "31 January 2027 is a Sunday, so the next business day",
      miscElectronic: "2027-03-31",
    },
  },
};

/** The default year: the payments being closed out. From July on that is this year; before, last year. */
export function defaultYear(now: Date): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
