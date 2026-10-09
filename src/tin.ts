/**
 * Taxpayer identification numbers. A TIN is read from the user's own file, written only into the
 * IRIS CSVs on the user's own disk, and never printed, logged or returned in full: everything a
 * person or an agent sees is `maskTin`, the last four digits at most.
 */

export type TinType = "SSN" | "EIN" | "ITIN" | "ATIN";

export interface Tin {
  /** nine digits, no dashes; stays in memory and in the IRIS CSV, nowhere else */
  digits: string;
  type: TinType | null;
}

/** The digits of a TIN as written in a report (dashes, spaces), or null when it is not nine digits. */
export function parseTin(raw: string, declaredType?: string): Tin | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) return null;
  const declared = normaliseTinType(declaredType);
  if (declared) return { digits, type: declared };
  // the way it was written says which kind it is
  if (/^\d{2}-\d{7}$/.test(trimmed)) return { digits, type: "EIN" };
  if (/^\d{3}-\d{2}-\d{4}$/.test(trimmed)) return { digits, type: isItin(digits) ? "ITIN" : "SSN" };
  return { digits, type: null };
}

/** An ITIN starts with 9 and has 50–65, 70–88, 90–92 or 94–99 as its fourth and fifth digits. */
export function isItin(digits: string): boolean {
  if (!digits.startsWith("9")) return false;
  const mid = Number(digits.slice(3, 5));
  return (
    (mid >= 50 && mid <= 65) || (mid >= 70 && mid <= 88) || (mid >= 90 && mid <= 92) || mid >= 94
  );
}

export function normaliseTinType(raw: string | undefined): TinType | null {
  const v = (raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (v === "SSN" || v === "SOCIALSECURITYNUMBER") return "SSN";
  if (v === "EIN" || v === "FEIN" || v === "EMPLOYERIDENTIFICATIONNUMBER") return "EIN";
  if (v === "ITIN") return "ITIN";
  if (v === "ATIN") return "ATIN";
  return null;
}

/** What may be shown: the last four digits, in the shape of the TIN's type. */
export function maskTin(tin: Tin | null): string | null {
  if (!tin) return null;
  const last4 = tin.digits.slice(-4);
  return tin.type === "EIN" ? `**-***${last4}` : `***-**-${last4}`;
}

/** The IRIS layout: EIN as XX-XXXXXXX, SSN/ITIN/ATIN as XXX-XX-XXXX. */
export function formatTin(tin: Tin, type: TinType): string {
  const d = tin.digits;
  return type === "EIN"
    ? `${d.slice(0, 2)}-${d.slice(2)}`
    : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** Every nine-digit run in a string replaced by its mask: the last guard before anything prints. */
export function redactTins(text: string): string {
  return text.replace(
    /\b(\d{3}-?\d{2}-?|\d{2}-?\d{3})(\d{4})\b/g,
    (_m, _head: string, last4: string) => `*****${last4}`,
  );
}
