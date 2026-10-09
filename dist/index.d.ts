/**
 * The IRS documents every rule here comes from, each with the date it was read, and the exact
 * sentence each rule applies. Output never states a rule without its sentence and its source.
 *
 * Read on 8 October 2026. When the IRS revises a document, read it again, update the sentence and
 * the date together, and let src/rules.test.ts say what moved.
 */
interface Source {
    id: SourceId;
    title: string;
    url: string;
    /** what the document says about itself: its revision, or the page's "last reviewed" date */
    revision: string;
    /** the day we read it, ISO */
    seen: string;
}
type SourceId = "i1099mec-2026" | "i1099mec-2025" | "i1099k-2026" | "p1099-2026" | "iris-efile" | "iris-ty2025-guidelines" | "iris-faq" | "iris-101-qa" | "fire";
declare const SOURCES: Readonly<Record<SourceId, Source>>;
/** One IRS sentence and where it is. */
interface Citation {
    source: SourceId;
    /** the sentence, verbatim; "…" marks words left out */
    quote: string;
}
type CitationId = "nec-2026" | "nec-2025" | "threshold-change" | "misc-royalties" | "misc-attorney-2026" | "misc-2000-2026" | "misc-600-2025" | "payment-card" | "corporation-exception" | "attorney-corporations" | "medical-corporations" | "merchandise" | "tax-exempt" | "withholding-files" | "nec-due" | "misc-due" | "next-business-day" | "w9-request" | "backup-withholding" | "llc-disregarded" | "tpso-threshold" | "k-6050w" | "k-de-minimis" | "iris-100" | "iris-headers" | "iris-250" | "fire-last-day" | "iris-only" | "new-boxes-2026";
declare const CITATIONS: Readonly<Record<CitationId, Citation>>;
/** A citation with its source, ready to print or serialise. */
interface ResolvedCitation {
    quote: string;
    source: string;
    url: string;
    seen: string;
}
declare function cite(id: CitationId, year?: number): ResolvedCitation;
/** Every output carries this, word for word. */
declare const DISCLAIMER = "Prepared for your review, not tax advice.";

/**
 * The rules for one payment year, each with the IRS sentence it comes from (src/sources.ts).
 *
 * Only 2025 and 2026 are here. 2027's thresholds "may be adjusted for inflation beginning in
 * calendar year 2027", and the IRS has not said by how much, so a 2027 run is refused rather than
 * guessed at.
 */

declare const YEARS: readonly [2025, 2026];
type Year = (typeof YEARS)[number];
/** What a payment was for, as far as the 1099 boxes care. */
type Kind = "services" | "attorney_fees" | "attorney_proceeds" | "rents" | "royalties" | "other_income" | "medical" | "goods";
/** How it was paid. Card and payment-network payments are the card company's or network's to report. */
type Method = "card" | "network" | "direct";
type MiscBox = "rents" | "royalties" | "other_income" | "medical" | "attorney_proceeds";
interface MiscRule {
    kind: MiscBox;
    /** the box on Form 1099-MISC */
    box: string;
    /** dollars; the payment must be at least this */
    threshold: number;
    cite: CitationId;
}
interface YearRules {
    year: Year;
    /** at least this much NEC (services plus attorney fees) needs a 1099-NEC */
    necThreshold: number;
    /** "1" for 2025 forms, "1a" for the December 2026 revision */
    necBox: string;
    necCite: CitationId;
    misc: readonly MiscRule[];
    /** ISO dates: 1099-NEC to the IRS and to recipients; 1099-MISC to the IRS filed electronically */
    due: {
        nec: string;
        necNote: string;
        miscElectronic: string;
    };
}
declare const RULES: Readonly<Record<Year, YearRules>>;

/**
 * Taxpayer identification numbers. A TIN is read from the user's own file, written only into the
 * IRIS CSVs on the user's own disk, and never printed, logged or returned in full: everything a
 * person or an agent sees is `maskTin`, the last four digits at most.
 */
type TinType = "SSN" | "EIN" | "ITIN" | "ATIN";
interface Tin {
    /** nine digits, no dashes; stays in memory and in the IRIS CSV, nowhere else */
    digits: string;
    type: TinType | null;
}
/** What may be shown: the last four digits, in the shape of the TIN's type. */
declare function maskTin(tin: Tin | null): string | null;

type Field = "name" | "dba" | "amount" | "method" | "category" | "date" | "tin" | "tin_type" | "entity" | "w9" | "withheld" | "address1" | "address2" | "city" | "state" | "zip" | "country";
declare const FIELDS: readonly Field[];
declare class InputError extends Error {
    readonly code: string;
    readonly cause_: string;
    readonly fix: string;
    constructor(code: string, cause_: string, fix: string);
}
/** `name=Vendor,amount="Paid out"` → { name: "Vendor", amount: "Paid out" } */
declare function parseMap(spec: string | undefined): Partial<Record<Field, string>>;
interface Payment {
    payee: string;
    /** cents; negative for a refund or credit */
    cents: number;
    kind: Kind;
    /** true when nothing in the row said what it was for, so it was taken to be services */
    kindAssumed: boolean;
    method: Method;
    /** what the row said about the method, for the reason text */
    methodLabel: string;
    date: string | null;
    row: number;
}
interface PayeeInfo {
    name: string;
    dba: string | null;
    tin: Tin | null;
    /** a TIN column held something that is not nine digits */
    tinUnreadable: boolean;
    entityLabel: string | null;
    w9: boolean | null;
    withheldCents: number;
    address: {
        line1: string;
        line2: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };
}
interface ParsedReport {
    shape: "payments" | "summary";
    headerRow: number;
    columns: Partial<Record<Field, string>>;
    boxColumns: {
        header: string;
        kind: Kind;
    }[];
    payments: Payment[];
    payees: Map<string, PayeeInfo>;
    skippedRows: {
        row: number;
        why: string;
    }[];
}
declare function readReport(text: string, mapSpec?: string): ParsedReport;

/**
 * Who needs which form for one payment year, and why: the rules in src/rules.ts applied to the
 * payments a report holds, payee by payee. Every reason names the IRS sentence it applies.
 *
 * Where the file cannot settle a question (no entity type, no W-9), the decision is the one that
 * cannot cost a penalty — file — and the payee is listed under "check" with what to confirm.
 */

type EntityClass = "corporation" | "tax_exempt" | "not_corporation" | "unknown";
interface FormLine {
    form: "1099-NEC" | "1099-MISC";
    box: string;
    kind: Kind;
    cents: number;
    reason: string;
    cites: CitationId[];
}
interface NotFiled {
    /** what the amount is and where it goes instead, if anywhere */
    what: "card_or_network" | "goods" | "corporation" | "tax_exempt" | "under_threshold";
    cents: number;
    reason: string;
    cites: CitationId[];
}
interface Decision {
    payee: string;
    status: "file" | "no_form";
    forms: FormLine[];
    notFiled: NotFiled[];
    /** what to confirm before filing; empty when the file settled everything */
    checks: {
        text: string;
        cites: CitationId[];
    }[];
    entity: {
        label: string | null;
        class: EntityClass;
        inferred: boolean;
    };
    w9: "on_file" | "missing" | "unknown";
    tinMasked: string | null;
    totalCents: number;
}
interface Assessment {
    year: Year;
    rules: YearRules;
    decisions: Decision[];
    /** payees who need a form and have no W-9 or TIN on file */
    missingW9: string[];
    /** payments dated in another year, left out */
    otherYearPayments: number;
    assumedKindPayments: number;
}
/** The W-9's federal tax classification, or a report's entity column, as one of four classes. */
declare function classifyEntity(label: string | null, name: string): {
    class: EntityClass;
    inferred: boolean;
};
declare function decide(info: PayeeInfo, payments: readonly Payment[], rules: YearRules): Decision;
declare function assess(report: ParsedReport, year: Year): Assessment;

declare const BATCH_SIZE = 100;
type IrisForm = "1099-NEC" | "1099-MISC";
/** Our name for each value a row can carry. */
type Key = "form_type" | "tax_year" | "payer_tin_type" | "payer_tin" | "payer_name_type" | "payer_name1" | "payer_name2" | "payer_first" | "payer_middle" | "payer_last" | "payer_suffix" | "payer_country" | "payer_address1" | "payer_address2" | "payer_city" | "payer_state" | "payer_zip" | "payer_phone_type" | "payer_phone" | "recipient_tin_type" | "recipient_tin" | "recipient_name_type" | "recipient_name1" | "recipient_name2" | "recipient_first" | "recipient_middle" | "recipient_last" | "recipient_suffix" | "recipient_country" | "recipient_address1" | "recipient_address2" | "recipient_city" | "recipient_state" | "recipient_zip" | "office_code" | "account_number" | "fatca" | "second_tin_notice" | "nec_box1" | "nec_box2" | "nec_box3" | "box4_withheld" | "misc_box1" | "misc_box2" | "misc_box3" | "misc_box5" | "misc_box6" | "misc_box7" | "misc_box8" | "misc_box9" | "misc_box10" | "misc_box11" | "misc_box12" | "misc_box15" | "cfsf" | `state${1 | 2}_${"code" | "withheld" | "number" | "income" | "local" | "special"}`;
type Column = readonly [header: string, key: Key];
/** Columns A–BB of the TY2025 1099-NEC template formatting guidelines. */
declare const NEC_COLUMNS: readonly Column[];
/** Columns A–BL of the TY2025 1099-MISC template formatting guidelines. */
declare const MISC_COLUMNS: readonly Column[];
/** The filer, from --payer <file.json>. Its TIN is masked everywhere but the CSVs. */
interface Payer {
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
declare function readPayer(json: unknown): Payer;
interface RowProblem {
    payee: string;
    form: IrisForm;
    /** a required value that is missing or cannot be made valid; the row will not upload until fixed */
    missing: string[];
    /** values changed to fit the guidelines */
    fixed: string[];
}
interface IrisFile {
    path: string;
    form: IrisForm;
    records: number;
    batch: number;
    of: number;
}
interface IrisPlan {
    layout: string;
    layoutNote: string;
    headerSource: Partial<Record<IrisForm, string>>;
    batchSize: number;
    files: IrisFile[];
    problems: RowProblem[];
    /** template columns that matched nothing we write, per form */
    unmatchedTemplateColumns: Partial<Record<IrisForm, string[]>>;
}
declare function planIris(assessment: Assessment, payees: ReadonlyMap<string, PayeeInfo>, payer: Payer | null, templates?: readonly {
    form: IrisForm;
    headers: string[];
}[]): {
    plan: IrisPlan;
    rows: Record<IrisForm, string[][]>;
    header: Record<IrisForm, string[]>;
};
/** Write the batches and LAYOUT.txt into `dir`; returns the files with their full paths. */
declare function writeIris(dir: string, planned: ReturnType<typeof planIris>, disclaimer: string): IrisFile[];

/**
 * One run's result as data: what `--json` prints, what the MCP tool returns, and what the text
 * output is drawn from. TINs appear masked (last four digits) and nowhere else.
 */

interface CitationOut {
    n: number;
    id: CitationId;
    quote: string;
    source: string;
    url: string;
    seen: string;
}
interface Report {
    tool: "iris-1099";
    version: string;
    disclaimer: string;
    year: number;
    input: {
        file: string;
        shape: ParsedReport["shape"];
        header_row: number;
        columns: ParsedReport["columns"];
        box_columns: string[];
        payments: number;
        skipped_rows: number;
        other_year_payments: number;
        payments_assumed_services: number;
    };
    thresholds: {
        nec: string;
        misc: {
            box: string;
            what: string;
            at_least: string;
        }[];
    };
    summary: {
        payees: number;
        need_a_form: number;
        no_form: number;
        to_check: number;
        missing_w9: number;
        forms_1099_nec: number;
        forms_1099_misc: number;
    };
    payees: PayeeOut[];
    missing_w9: string[];
    iris: {
        layout: string;
        layout_note: string;
        header_source: IrisPlan["headerSource"];
        batch_size: number;
        written_to: string | null;
        files: {
            file: string;
            form: string;
            records: number;
        }[];
        fix_before_upload: {
            payee: string;
            form: string;
            missing: string[];
        }[];
        cleaned: {
            payee: string;
            form: string;
            changes: string[];
        }[];
        unmatched_template_columns: IrisPlan["unmatchedTemplateColumns"];
    };
    deadlines: {
        date: string;
        what: string;
        cite: number[];
    }[];
    citations: CitationOut[];
    waitlist: {
        offer: string;
        price: string;
        status: string;
        url: string;
    };
}
interface PayeeOut {
    name: string;
    status: "file" | "no_form";
    forms: {
        form: string;
        box: string;
        amount: string;
        reason: string;
        cite: number[];
    }[];
    not_filed: {
        what: string;
        amount: string;
        reason: string;
        cite: number[];
    }[];
    checks: {
        text: string;
        cite: number[];
    }[];
    entity: string | null;
    entity_class: Decision["entity"]["class"];
    w9: Decision["w9"];
    tin: string | null;
    total_paid: string;
}
declare function buildReport(file: string, parsed: ParsedReport, assessment: Assessment, plan: IrisPlan, written: {
    dir: string;
    files: IrisFile[];
} | null): Report;

interface CheckOptions {
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
declare function runCheck(opts: CheckOptions): Report;

interface ToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, Record<string, unknown>>;
        required?: string[];
        additionalProperties: false;
    };
    annotations: {
        title: string;
        readOnlyHint: true;
        destructiveHint: false;
        idempotentHint: true;
        openWorldHint: false;
    };
}
declare const TOOLS: readonly ToolDefinition[];
interface McpContext {
    cwd?: string;
    now?: () => Date;
}
declare function callTool(name: string, rawArgs: unknown, ctx?: McpContext): {
    structured: Record<string, unknown>;
    isError: boolean;
};

export { type Assessment, BATCH_SIZE, CITATIONS, type CheckOptions, DISCLAIMER, type Decision, FIELDS, InputError, MISC_COLUMNS, NEC_COLUMNS, type ParsedReport, RULES, type Report, SOURCES, TOOLS, YEARS, type Year, type YearRules, assess, buildReport, callTool, cite, classifyEntity, decide, maskTin, parseMap, planIris, readPayer, readReport, runCheck, writeIris };
