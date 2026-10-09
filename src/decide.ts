/**
 * Who needs which form for one payment year, and why: the rules in src/rules.ts applied to the
 * payments a report holds, payee by payee. Every reason names the IRS sentence it applies.
 *
 * Where the file cannot settle a question (no entity type, no W-9), the decision is the one that
 * cannot cost a penalty — file — and the payee is listed under "check" with what to confirm.
 */
import type { ParsedReport, PayeeInfo, Payment } from "./input.js";
import { KIND_LABEL, RULES, type Kind, type MiscBox, type Year, type YearRules } from "./rules.js";
import type { CitationId } from "./sources.js";
import { maskTin } from "./tin.js";

export type EntityClass = "corporation" | "tax_exempt" | "not_corporation" | "unknown";

export interface FormLine {
  form: "1099-NEC" | "1099-MISC";
  box: string;
  kind: Kind;
  cents: number;
  reason: string;
  cites: CitationId[];
}

export interface NotFiled {
  /** what the amount is and where it goes instead, if anywhere */
  what: "card_or_network" | "goods" | "corporation" | "tax_exempt" | "under_threshold";
  cents: number;
  reason: string;
  cites: CitationId[];
}

export interface Decision {
  payee: string;
  status: "file" | "no_form";
  forms: FormLine[];
  notFiled: NotFiled[];
  /** what to confirm before filing; empty when the file settled everything */
  checks: { text: string; cites: CitationId[] }[];
  entity: { label: string | null; class: EntityClass; inferred: boolean };
  w9: "on_file" | "missing" | "unknown";
  tinMasked: string | null;
  totalCents: number;
}

export interface Assessment {
  year: Year;
  rules: YearRules;
  decisions: Decision[];
  /** payees who need a form and have no W-9 or TIN on file */
  missingW9: string[];
  /** payments dated in another year, left out */
  otherYearPayments: number;
  assumedKindPayments: number;
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The W-9's federal tax classification, or a report's entity column, as one of four classes. */
export function classifyEntity(
  label: string | null,
  name: string,
): { class: EntityClass; inferred: boolean } {
  const t = (label ?? "").toLowerCase();
  if (t) {
    if (/exempt|501\s*\(?c|non-?profit|government|municipal|\bstate of\b|federal agency/.test(t))
      return { class: "tax_exempt", inferred: false };
    if (
      /partnership|\bp\b$|llc[\s-]*p\b|sole|individual|single[- ]member|disregarded|smllc|trust|estate/.test(
        t,
      )
    )
      return { class: "not_corporation", inferred: false };
    if (/\bc\b|\bs\b|corp|c-corp|s-corp|incorporated|\binc\b|llc[\s-]*[cs]\b/.test(t))
      return { class: "corporation", inferred: false };
    if (/^llc$|limited liability/.test(t)) return { class: "unknown", inferred: false };
  }
  // A name incorporated under state law is a corporation; its W-9 still has the final word.
  if (/\b(inc|incorporated|corp|corporation|p\.?c|pllc)\.?$/i.test(name.trim().replace(/[,]/g, "")))
    return { class: name.match(/pllc\.?$/i) ? "unknown" : "corporation", inferred: true };
  return { class: "unknown", inferred: true };
}

function w9Status(info: PayeeInfo): Decision["w9"] {
  if (info.w9 === true) return "on_file";
  if (info.w9 === false) return "missing";
  if (info.tin) return "on_file";
  return info.tinUnreadable ? "missing" : "unknown";
}

function sum(payments: readonly Payment[], pick: (p: Payment) => boolean): number {
  return payments.filter(pick).reduce((n, p) => n + p.cents, 0);
}

export function decide(info: PayeeInfo, payments: readonly Payment[], rules: YearRules): Decision {
  const forms: FormLine[] = [];
  const notFiled: NotFiled[] = [];
  const checks: { text: string; cites: CitationId[] }[] = [];
  const entity = classifyEntity(info.entityLabel, info.name);
  const w9 = w9Status(info);
  const total = sum(payments, () => true);
  const corp = entity.class === "corporation";

  // 1. Card and payment-network amounts: the card company's or network's 1099-K, not yours.
  const viaK = payments.filter((p) => p.method !== "direct");
  const kCents = sum(viaK, () => true);
  if (kCents > 0) {
    const labels = [...new Set(viaK.map((p) => p.methodLabel).filter(Boolean))].join(", ");
    const network = viaK.some((p) => p.method === "network");
    notFiled.push({
      what: "card_or_network",
      cents: kCents,
      reason:
        `${money(kCents)} paid by ${labels || (network ? "a payment network" : "card")}: reported on Form 1099-K by the card company or payment network, not on your 1099-NEC or 1099-MISC` +
        (network
          ? ", even when the network files no 1099-K because the payee is under its threshold. A personal (friends-and-family) transfer is not a payment-network transaction; if that is how it was paid, mark it so and it counts as yours."
          : "."),
      cites: network ? ["payment-card", "k-de-minimis"] : ["payment-card"],
    });
  }
  const direct = payments.filter((p) => p.method === "direct");

  // 2. Merchandise and similar items are never reported.
  const goods = sum(direct, (p) => p.kind === "goods");
  if (goods > 0)
    notFiled.push({
      what: "goods",
      cents: goods,
      reason: `${money(goods)} for merchandise and similar items: not reported.`,
      cites: ["merchandise"],
    });

  if (entity.class === "tax_exempt") {
    const rest = sum(direct, (p) => p.kind !== "goods");
    if (rest > 0)
      notFiled.push({
        what: "tax_exempt",
        cents: rest,
        reason: `${money(rest)} to a tax-exempt organization or government (${info.entityLabel}): not reported.`,
        cites: ["tax-exempt"],
      });
    return finish();
  }

  // 3. 1099-NEC: services and attorney fees together.
  const services = sum(direct, (p) => p.kind === "services");
  const attorneyFees = sum(direct, (p) => p.kind === "attorney_fees");
  const corpExempt = corp ? services : 0;
  if (corpExempt > 0)
    notFiled.push({
      what: "corporation",
      cents: corpExempt,
      reason: `${money(corpExempt)} for services to a corporation (${entityWords()}): exempt.`,
      cites: ["corporation-exception"],
    });
  const nec = (corp ? 0 : services) + attorneyFees;
  const necThreshold = rules.necThreshold * 100;
  if (nec > 0) {
    const parts = [
      !corp && services > 0 ? `${money(services)} for services` : "",
      attorneyFees > 0 ? `${money(attorneyFees)} in attorney fees` : "",
    ].filter(Boolean);
    const what = parts.join(" and ");
    const cites: CitationId[] = [rules.necCite];
    if (corp && attorneyFees > 0) cites.push("attorney-corporations");
    if (nec >= necThreshold) {
      forms.push({
        form: "1099-NEC",
        box: rules.necBox,
        kind: attorneyFees > 0 && services === 0 ? "attorney_fees" : "services",
        cents: nec,
        reason: `${what} is at least ${dollars(rules.necThreshold)}${corp && attorneyFees > 0 ? "; attorney fees are reported even to a corporation" : ""}.`,
        cites,
      });
    } else if (info.withheldCents > 0) {
      forms.push({
        form: "1099-NEC",
        box: rules.necBox,
        kind: "services",
        cents: nec,
        reason: `${what} is under ${dollars(rules.necThreshold)}, but ${money(info.withheldCents)} of federal income tax was withheld, so it is reported regardless of the amount.`,
        cites: [...cites, "withholding-files"],
      });
    } else {
      const was2025 = rules.year === 2026 && nec >= RULES[2025].necThreshold * 100;
      notFiled.push({
        what: "under_threshold",
        cents: nec,
        reason: `${what} is under ${dollars(rules.necThreshold)}, the ${rules.year} threshold${was2025 ? `; at 2025's ${dollars(RULES[2025].necThreshold)} it would have needed a 1099-NEC` : ""}.`,
        cites: was2025 ? [rules.necCite, "threshold-change"] : [rules.necCite],
      });
    }
  }

  // 4. 1099-MISC, box by box.
  const miscCorpExempt: Kind[] = [];
  for (const rule of rules.misc) {
    const cents = sum(direct, (p) => p.kind === rule.kind);
    if (cents <= 0) continue;
    const exemptForCorp =
      corp && !(["medical", "attorney_proceeds"] as MiscBox[]).includes(rule.kind);
    if (exemptForCorp) {
      miscCorpExempt.push(rule.kind);
      notFiled.push({
        what: "corporation",
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} to a corporation (${entityWords()}): exempt.`,
        cites: ["corporation-exception"],
      });
      continue;
    }
    const cites: CitationId[] = [rule.cite];
    if (corp && rule.kind === "medical") cites.push("medical-corporations");
    if (corp && rule.kind === "attorney_proceeds") cites.push("attorney-corporations");
    if (cents >= rule.threshold * 100) {
      forms.push({
        form: "1099-MISC",
        box: rule.box,
        kind: rule.kind,
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} is at least ${dollars(rule.threshold)}${corp ? "; reported even to a corporation" : ""}.`,
        cites,
      });
    } else {
      notFiled.push({
        what: "under_threshold",
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} is under ${dollars(rule.threshold)}.`,
        cites,
      });
    }
  }

  return finish();

  function entityWords(): string {
    return entity.inferred
      ? `the name says so; confirm on its W-9`
      : `${info.entityLabel ?? "corporation"}`;
  }

  function finish(): Decision {
    const files = forms.length > 0;
    if (files && w9 !== "on_file") {
      checks.push({
        text:
          w9 === "missing"
            ? "No W-9 on file: request one before you file. Without a TIN, backup withholding at 24% applies to further payments."
            : "No TIN in the file: confirm a W-9 is on file, or request one before you file.",
        cites: ["w9-request", "backup-withholding"],
      });
    }
    if (files && entity.class === "unknown" && !entity.inferred) {
      checks.push({
        text: "Entity type says LLC without its tax classification: the W-9's line 3 says whether it is taxed as a C or S corporation (exempt for services) or not.",
        cites: ["corporation-exception"],
      });
    } else if (files && entity.class === "unknown") {
      checks.push({
        text: "No entity type in the file: a W-9 showing a C or S corporation (including an LLC taxed as one) would make services and rents exempt.",
        cites: ["corporation-exception"],
      });
    }
    if (corp && entity.inferred && notFiled.some((n) => n.what === "corporation")) {
      checks.push({
        text: "Exempt only because the name ends in Inc or Corp: confirm the W-9 says C or S corporation.",
        cites: ["corporation-exception"],
      });
    }
    if (payments.some((p) => p.kindAssumed) && files)
      checks.push({
        text: "Nothing in the file said what some payments were for; they were counted as services.",
        cites: [],
      });
    return {
      payee: info.name,
      status: files ? "file" : "no_form",
      forms,
      notFiled,
      checks,
      entity: { label: info.entityLabel, class: entity.class, inferred: entity.inferred },
      w9,
      tinMasked: maskTin(info.tin),
      totalCents: total,
    };
  }
}

export function assess(report: ParsedReport, year: Year): Assessment {
  const rules = RULES[year];
  const inYear = report.payments.filter((p) => !p.date || p.date.startsWith(`${year}-`));
  const otherYearPayments = report.payments.length - inYear.length;
  const byPayee = new Map<string, Payment[]>();
  for (const p of inYear) byPayee.set(p.payee, [...(byPayee.get(p.payee) ?? []), p]);
  const decisions: Decision[] = [];
  for (const [name, payments] of byPayee) {
    const info = report.payees.get(name)!;
    decisions.push(decide(info, payments, rules));
  }
  decisions.sort(
    (a, b) =>
      Number(b.status === "file") - Number(a.status === "file") ||
      b.totalCents - a.totalCents ||
      a.payee.localeCompare(b.payee),
  );
  return {
    year,
    rules,
    decisions,
    missingW9: decisions
      .filter((d) => d.status === "file" && d.w9 !== "on_file")
      .map((d) => d.payee),
    otherYearPayments,
    assumedKindPayments: inYear.filter((p) => p.kindAssumed).length,
  };
}
