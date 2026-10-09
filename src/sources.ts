/**
 * The IRS documents every rule here comes from, each with the date it was read, and the exact
 * sentence each rule applies. Output never states a rule without its sentence and its source.
 *
 * Read on 8 October 2026. When the IRS revises a document, read it again, update the sentence and
 * the date together, and let src/rules.test.ts say what moved.
 */

export interface Source {
  id: SourceId;
  title: string;
  url: string;
  /** what the document says about itself: its revision, or the page's "last reviewed" date */
  revision: string;
  /** the day we read it, ISO */
  seen: string;
}

export type SourceId =
  | "i1099mec-2026"
  | "i1099mec-2025"
  | "i1099k-2026"
  | "p1099-2026"
  | "iris-efile"
  | "iris-ty2025-guidelines"
  | "iris-faq"
  | "iris-101-qa"
  | "fire";

const SEEN = "2026-10-08";

export const SOURCES: Readonly<Record<SourceId, Source>> = {
  "i1099mec-2026": {
    id: "i1099mec-2026",
    title: "Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026)",
    url: "https://www.irs.gov/instructions/i1099mec",
    revision: "Rev. December 2026; for 2026 information filed in early 2027",
    seen: SEEN,
  },
  "i1099mec-2025": {
    id: "i1099mec-2025",
    title: "Instructions for Forms 1099-MISC and 1099-NEC (Rev. April 2025)",
    url: "https://www.irs.gov/pub/irs-prior/i1099mec--2025.pdf",
    revision: "Rev. April 2025; the revision for 2025 information",
    seen: SEEN,
  },
  "i1099k-2026": {
    id: "i1099k-2026",
    title: "Instructions for Form 1099-K (Rev. December 2026)",
    url: "https://www.irs.gov/instructions/i1099k",
    revision: "Rev. December 2026",
    seen: SEEN,
  },
  "p1099-2026": {
    id: "p1099-2026",
    title: "Publication 1099 (2026), General Instructions for Certain Information Returns",
    url: "https://www.irs.gov/pub/irs-pdf/p1099.pdf",
    revision: "2026",
    seen: SEEN,
  },
  "iris-efile": {
    id: "iris-efile",
    title: "E-file information returns with IRIS",
    url: "https://www.irs.gov/filing/e-file-information-returns-with-iris",
    revision: "page last reviewed or updated 7 Oct 2026",
    seen: SEEN,
  },
  "iris-ty2025-guidelines": {
    id: "iris-ty2025-guidelines",
    title: "IRIS CSV template formatting guidelines, tax year 2025 (ZIP)",
    url: "https://www.irs.gov/pub/irs-efile/ty2025-template-formatting-guidelines.zip",
    revision: "updated 14 Jan 2026; the newest tax year posted on 8 Oct 2026",
    seen: SEEN,
  },
  "iris-faq": {
    id: "iris-faq",
    title: "Information Returns Intake System (IRIS) FAQs",
    url: "https://www.irs.gov/pub/irs-efile/info-returns-intake-system-faqs.pdf",
    revision: "PDF dated 10 Feb 2025",
    seen: SEEN,
  },
  "iris-101-qa": {
    id: "iris-101-qa",
    title: "IRIS 101 questions and answers (5 Aug 2025)",
    url: "https://www.irs.gov/pub/irs-efile/irs-101-q-and-a-08052025.pdf",
    revision: "5 Aug 2025",
    seen: SEEN,
  },
  fire: {
    id: "fire",
    title: "Filing Information Returns Electronically (FIRE)",
    url: "https://www.irs.gov/e-file-providers/filing-information-returns-electronically-fire",
    revision: "page last reviewed or updated 7 Aug 2026",
    seen: SEEN,
  },
};

/** One IRS sentence and where it is. */
export interface Citation {
  source: SourceId;
  /** the sentence, verbatim; "…" marks words left out */
  quote: string;
}

export type CitationId =
  | "nec-2026"
  | "nec-2025"
  | "threshold-change"
  | "misc-royalties"
  | "misc-attorney-2026"
  | "misc-2000-2026"
  | "misc-600-2025"
  | "payment-card"
  | "corporation-exception"
  | "attorney-corporations"
  | "medical-corporations"
  | "merchandise"
  | "tax-exempt"
  | "withholding-files"
  | "nec-due"
  | "misc-due"
  | "next-business-day"
  | "w9-request"
  | "backup-withholding"
  | "llc-disregarded"
  | "tpso-threshold"
  | "k-6050w"
  | "k-de-minimis"
  | "iris-100"
  | "iris-headers"
  | "iris-250"
  | "fire-last-day"
  | "iris-only"
  | "new-boxes-2026";

export const CITATIONS: Readonly<Record<CitationId, Citation>> = {
  "nec-2026": {
    source: "i1099mec-2026",
    quote:
      "File Form 1099-NEC, Nonemployee Compensation, for each person in the course of your business during the year to whom you have paid at least $2,000 in: 1. Services performed by someone who is not your employee (including parts and materials) (box 1a); or 2. Payments to an attorney (box 1a).",
  },
  "nec-2025": {
    source: "i1099mec-2025",
    quote:
      "File Form 1099-NEC, Nonemployee Compensation, for each person in the course of your business to whom you have paid the following during the year. • At least $600 in: 1. Services performed by someone who is not your employee (including parts and materials) (box 1); or 2. Payments to an attorney (box 1).",
  },
  "threshold-change": {
    source: "i1099mec-2026",
    quote:
      "For tax years beginning after 2025, the minimum threshold amount for reporting certain payments required to be reported on certain information returns and/or perform backup withholding on those payments increased to $2,000 and may be adjusted for inflation beginning in calendar year 2027.",
  },
  "misc-royalties": {
    source: "i1099mec-2026",
    quote: "At least $10 in royalties (see the instructions for box 2) …",
  },
  "misc-attorney-2026": {
    source: "i1099mec-2026",
    quote:
      "At least $600 in gross proceeds paid to an attorney (box 10) (see Payments to attorneys, later).",
  },
  "misc-2000-2026": {
    source: "i1099mec-2026",
    quote:
      "At least $2,000 in: 1. Rents (box 1); 2. Prizes and awards, including certain non-government grants (box 3); 3. Other income payments (box 3); … 5. Medical and health care payments (box 6); …",
  },
  "misc-600-2025": {
    source: "i1099mec-2025",
    quote:
      "At least $600 in: 1. Rents (box 1); 2. Prizes and awards, including certain non-government grants (box 3); 3. Other income payments (box 3); … 6. Medical and health care payments (box 6); … 8. Gross proceeds paid to an attorney (box 10) (see Payments to attorneys, later); …",
  },
  "payment-card": {
    source: "i1099mec-2026",
    quote:
      "Payments made with a credit card or payment card and certain other types of payments, including third-party network transactions, must be reported on Form 1099-K by the payment settlement entity under section 6050W and are not subject to reporting on Form 1099-MISC or Form 1099-NEC.",
  },
  "corporation-exception": {
    source: "i1099mec-2026",
    quote:
      "Generally, payments to a corporation (including a limited liability company (LLC) that is treated as a C or S corporation). However, see Reportable payments to corporations, earlier.",
  },
  "attorney-corporations": {
    source: "i1099mec-2026",
    quote:
      "The exemption from reporting payments made to corporations does not apply to payments for legal services.",
  },
  "medical-corporations": {
    source: "i1099mec-2026",
    quote:
      "The exemption from issuing Form 1099-MISC to a corporation does not apply to payments for medical or health care services provided by corporations, including professional corporations.",
  },
  merchandise: {
    source: "i1099mec-2026",
    quote: "Payments for merchandise, telegrams, telephone, freight, storage, and similar items.",
  },
  "tax-exempt": {
    source: "i1099mec-2026",
    quote:
      "Payments to a tax-exempt organization including tax-exempt trusts (IRAs, HSAs, Archer MSAs, Coverdell ESAs, and ABLE (529A) accounts), the United States, a state, the District of Columbia, a U.S. territory, or a foreign government.",
  },
  "withholding-files": {
    source: "i1099mec-2026",
    quote:
      "You must also file Form 1099-NEC for each person from whom you have withheld any federal income tax (report in box 4) under the backup withholding rules regardless of the amount of the payment.",
  },
  "nec-due": {
    source: "i1099mec-2026",
    quote:
      "Section 6071(c) requires you to file Form 1099-NEC on or before January 31, using either paper or electronic filing procedures.",
  },
  "misc-due": {
    source: "i1099mec-2026",
    quote:
      "File Form 1099-MISC by February 28, if you file on paper, or March 31, if you file electronically.",
  },
  "next-business-day": {
    source: "i1099mec-2026",
    quote:
      "If any date shown falls on a Saturday, Sunday, or legal holiday in the District of Columbia or where the return is to be filed, the due date is the next business day.",
  },
  "w9-request": {
    source: "p1099-2026",
    quote:
      "If the recipient is a U.S. person (including a U.S. resident alien), the IRS suggests that you request the recipient complete Form W-9, Request for Taxpayer Identification Number and Certification; …",
  },
  "backup-withholding": {
    source: "p1099-2026",
    quote:
      "Interest …, dividends, rents, royalties, commissions, nonemployee compensation, and certain other payments … may be subject to backup withholding at a 24% rate.",
  },
  "llc-disregarded": {
    source: "p1099-2026",
    quote:
      "For a single-member LLC (including a foreign LLC with a U.S. owner) that is disregarded as an entity separate from its owner under Regulations section 301.7701-3, enter the owner’s name only on the first name line and the LLC’s name on the second name line.",
  },
  "tpso-threshold": {
    source: "i1099k-2026",
    quote:
      "A third party settlement organization (TPSO) is required to report payments in settlement of third party network transactions with any participating payee that exceed $20,000, and the total number of such transactions exceeds 200.",
  },
  "k-6050w": {
    source: "i1099k-2026",
    quote:
      "Payments made by payment card or through a third party payment network after December 31, 2010, that otherwise would be reportable under sections 6041 (payments made in the course of a trade or business to another person) or 6041A(a) (payments of remuneration for services and certain direct sales) and 6050W are reported under section 6050W and not section 6041 or 6041A.",
  },
  "k-de-minimis": {
    source: "i1099k-2026",
    quote:
      "For purposes of determining whether payments are subject to reporting under section 6050W, rather than section 6041 or 6041A, the de minimis threshold, discussed later under Box 1a, is disregarded.",
  },
  "iris-100": {
    source: "iris-faq",
    quote:
      "Each CSV file holds up to 100 records, not including the header. You may submit an unlimited number of templates.",
  },
  "iris-headers": {
    source: "iris-faq",
    quote:
      "The IRIS system validates the CSV column header descriptions. We recommend you download the newest templates to avoid errors when uploading CSV Files.",
  },
  "iris-250": {
    source: "iris-101-qa",
    quote:
      "The current CSV files is 100 records per upload. Beginning TY25/PY26 the record size will increase to 250.",
  },
  "fire-last-day": {
    source: "fire",
    quote:
      "Nov. 19, 2026, at 3 p.m. ET: Last day to file information returns through the FIRE system.",
  },
  "iris-only": {
    source: "fire",
    quote:
      "IRIS will be the only information returns electronic filing system, including current year, prior year, or corrections, after Jan. 1, 2027.",
  },
  "new-boxes-2026": {
    source: "i1099mec-2026",
    quote:
      "New boxes 1b and 13a. P.L. 119-21, section 70201, requires the reporting of cash tips. … New boxes 1c and 13b. Use the Treasury Tipped Occupation Code(s) to identify the tipped occupation(s) for Forms 1099-NEC and 1099-MISC. … New boxes 1d and 14. P.L. 119-21, Section 70202(a), requires the reporting of overtime compensation.",
  },
};

/** A citation with its source, ready to print or serialise. */
export interface ResolvedCitation {
  quote: string;
  source: string;
  url: string;
  seen: string;
}

/**
 * Sentences that read word for word the same in the April 2025 revision (checked 8 Oct 2026). For
 * a 2025 run they are cited from that revision, the one for 2025 information.
 */
export const SAME_IN_2025: ReadonlySet<CitationId> = new Set<CitationId>([
  "misc-royalties",
  "payment-card",
  "corporation-exception",
  "attorney-corporations",
  "medical-corporations",
  "merchandise",
  "tax-exempt",
  "withholding-files",
  "nec-due",
  "misc-due",
  "next-business-day",
]);

export function cite(id: CitationId, year?: number): ResolvedCitation {
  const c = CITATIONS[id];
  const sourceId = year === 2025 && SAME_IN_2025.has(id) ? "i1099mec-2025" : c.source;
  const s = SOURCES[sourceId];
  return { quote: c.quote, source: s.title, url: s.url, seen: s.seen };
}

/** Every output carries this, word for word. */
export const DISCLAIMER = "Prepared for your review, not tax advice.";
