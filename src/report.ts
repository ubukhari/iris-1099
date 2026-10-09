/**
 * One run's result as data: what `--json` prints, what the MCP tool returns, and what the text
 * output is drawn from. TINs appear masked (last four digits) and nowhere else.
 */
import type { Assessment, Decision } from "./decide.js";
import { money } from "./decide.js";
import type { ParsedReport } from "./input.js";
import type { IrisPlan, IrisFile } from "./iris.js";
import { KIND_LABEL } from "./rules.js";
import { cite, DISCLAIMER, type CitationId } from "./sources.js";
import { version } from "./version.js";
import { WAITLIST_CLI_URL, WAITLIST_OFFER, WAITLIST_PRICE, WAITLIST_STATUS } from "./waitlist.js";

export interface CitationOut {
  n: number;
  id: CitationId;
  quote: string;
  source: string;
  url: string;
  seen: string;
}

export interface Report {
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
  thresholds: { nec: string; misc: { box: string; what: string; at_least: string }[] };
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
    files: { file: string; form: string; records: number }[];
    fix_before_upload: { payee: string; form: string; missing: string[] }[];
    cleaned: { payee: string; form: string; changes: string[] }[];
    unmatched_template_columns: IrisPlan["unmatchedTemplateColumns"];
  };
  deadlines: { date: string; what: string; cite: number[] }[];
  citations: CitationOut[];
  waitlist: { offer: string; price: string; status: string; url: string };
}

export interface PayeeOut {
  name: string;
  status: "file" | "no_form";
  forms: { form: string; box: string; amount: string; reason: string; cite: number[] }[];
  not_filed: { what: string; amount: string; reason: string; cite: number[] }[];
  checks: { text: string; cite: number[] }[];
  entity: string | null;
  entity_class: Decision["entity"]["class"];
  w9: Decision["w9"];
  tin: string | null;
  total_paid: string;
}

export function buildReport(
  file: string,
  parsed: ParsedReport,
  assessment: Assessment,
  plan: IrisPlan,
  written: { dir: string; files: IrisFile[] } | null,
): Report {
  const order: CitationId[] = [];
  const n = (id: CitationId): number => {
    let i = order.indexOf(id);
    if (i < 0) i = order.push(id) - 1;
    return i + 1;
  };
  const { rules } = assessment;
  // the threshold sentences first, so [1] is always the year's 1099-NEC rule
  n(rules.necCite);
  for (const m of rules.misc) n(m.cite);

  const payees: PayeeOut[] = assessment.decisions.map((d) => ({
    name: d.payee,
    status: d.status,
    forms: d.forms.map((f) => ({
      form: f.form,
      box: f.box,
      amount: money(f.cents),
      reason: f.reason,
      cite: f.cites.map(n),
    })),
    not_filed: d.notFiled.map((x) => ({
      what: x.what,
      amount: money(x.cents),
      reason: x.reason,
      cite: x.cites.map(n),
    })),
    checks: d.checks.map((c) => ({ text: c.text, cite: c.cites.map(n) })),
    entity: d.entity.label,
    entity_class: d.entity.class,
    w9: d.w9,
    tin: d.tinMasked,
    total_paid: money(d.totalCents),
  }));

  const deadlines = [
    {
      date: "2026-11-19",
      what: "FIRE takes its last filing (3 p.m. ET); file anything still due through FIRE before then, or use IRIS",
      cite: [n("fire-last-day")],
    },
    {
      date: "2027-01-01",
      what: "IRIS becomes the only system for information returns, including prior years and corrections",
      cite: [n("iris-only")],
    },
    {
      date: rules.due.nec,
      what: `1099-NEC for ${rules.year} payments due to the IRS (${rules.due.necNote})`,
      cite: [n("nec-due"), n("next-business-day")],
    },
    {
      date: rules.due.miscElectronic,
      what: `1099-MISC for ${rules.year} payments due to the IRS when filed electronically`,
      cite: [n("misc-due")],
    },
  ];
  n("iris-100");
  n("iris-headers");
  if (rules.year !== 2025) n("new-boxes-2026");

  const formsOf = (form: string) =>
    assessment.decisions.filter((d) => d.forms.some((f) => f.form === form)).length;

  return {
    tool: "iris-1099",
    version: version(),
    disclaimer: DISCLAIMER,
    year: rules.year,
    input: {
      file,
      shape: parsed.shape,
      header_row: parsed.headerRow,
      columns: parsed.columns,
      box_columns: parsed.boxColumns.map((b) => b.header),
      payments: parsed.payments.length,
      skipped_rows: parsed.skippedRows.length,
      other_year_payments: assessment.otherYearPayments,
      payments_assumed_services: assessment.assumedKindPayments,
    },
    thresholds: {
      nec: `$${rules.necThreshold.toLocaleString("en-US")} (box ${rules.necBox})`,
      misc: rules.misc.map((m) => ({
        box: m.box,
        what: KIND_LABEL[m.kind],
        at_least: `$${m.threshold.toLocaleString("en-US")}`,
      })),
    },
    summary: {
      payees: payees.length,
      need_a_form: payees.filter((p) => p.status === "file").length,
      no_form: payees.filter((p) => p.status === "no_form").length,
      to_check: payees.filter((p) => p.checks.length > 0).length,
      missing_w9: assessment.missingW9.length,
      forms_1099_nec: formsOf("1099-NEC"),
      forms_1099_misc: formsOf("1099-MISC"),
    },
    payees,
    missing_w9: assessment.missingW9,
    iris: {
      layout: plan.layout,
      layout_note: plan.layoutNote,
      header_source: plan.headerSource,
      batch_size: plan.batchSize,
      written_to: written?.dir ?? null,
      files: (written?.files ?? plan.files).map((f) => ({
        file: f.path,
        form: f.form,
        records: f.records,
      })),
      fix_before_upload: plan.problems
        .filter((p) => p.missing.length)
        .map((p) => ({ payee: p.payee, form: p.form, missing: p.missing })),
      cleaned: plan.problems
        .filter((p) => p.fixed.length)
        .map((p) => ({ payee: p.payee, form: p.form, changes: p.fixed })),
      unmatched_template_columns: plan.unmatchedTemplateColumns,
    },
    deadlines,
    citations: order.map((id, i) => ({ n: i + 1, id, ...cite(id, rules.year) })),
    waitlist: {
      offer: WAITLIST_OFFER,
      price: WAITLIST_PRICE,
      status: WAITLIST_STATUS,
      url: WAITLIST_CLI_URL,
    },
  };
}
