// src/check.ts
import { readFileSync as readFileSync2 } from "fs";

// src/rules.ts
var YEARS = [2025, 2026];
function isYear(n) {
  return YEARS.includes(n);
}
var KIND_LABEL = {
  services: "services",
  attorney_fees: "attorney fees",
  attorney_proceeds: "gross proceeds paid to an attorney",
  rents: "rents",
  royalties: "royalties",
  other_income: "other income",
  medical: "medical and health care",
  goods: "merchandise and similar items"
};
var MISC_2025 = [
  { kind: "rents", box: "1", threshold: 600, cite: "misc-600-2025" },
  { kind: "royalties", box: "2", threshold: 10, cite: "misc-royalties" },
  { kind: "other_income", box: "3", threshold: 600, cite: "misc-600-2025" },
  { kind: "medical", box: "6", threshold: 600, cite: "misc-600-2025" },
  { kind: "attorney_proceeds", box: "10", threshold: 600, cite: "misc-600-2025" }
];
var MISC_2026 = [
  { kind: "rents", box: "1", threshold: 2e3, cite: "misc-2000-2026" },
  { kind: "royalties", box: "2", threshold: 10, cite: "misc-royalties" },
  { kind: "other_income", box: "3", threshold: 2e3, cite: "misc-2000-2026" },
  { kind: "medical", box: "6", threshold: 2e3, cite: "misc-2000-2026" },
  // attorneys' gross proceeds stayed at $600 (section 6045(f)); the December 2026 revision says so
  { kind: "attorney_proceeds", box: "10", threshold: 600, cite: "misc-attorney-2026" }
];
var RULES = {
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
      miscElectronic: "2026-03-31"
    }
  },
  2026: {
    year: 2026,
    necThreshold: 2e3,
    necBox: "1a",
    necCite: "nec-2026",
    misc: MISC_2026,
    // 31 Jan 2027 is a Sunday
    due: {
      nec: "2027-02-01",
      necNote: "31 January 2027 is a Sunday, so the next business day",
      miscElectronic: "2027-03-31"
    }
  }
};
function defaultYear(now) {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// src/tin.ts
function parseTin(raw, declaredType) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) return null;
  const declared = normaliseTinType(declaredType);
  if (declared) return { digits, type: declared };
  if (/^\d{2}-\d{7}$/.test(trimmed)) return { digits, type: "EIN" };
  if (/^\d{3}-\d{2}-\d{4}$/.test(trimmed)) return { digits, type: isItin(digits) ? "ITIN" : "SSN" };
  return { digits, type: null };
}
function isItin(digits) {
  if (!digits.startsWith("9")) return false;
  const mid = Number(digits.slice(3, 5));
  return mid >= 50 && mid <= 65 || mid >= 70 && mid <= 88 || mid >= 90 && mid <= 92 || mid >= 94;
}
function normaliseTinType(raw) {
  const v = (raw ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (v === "SSN" || v === "SOCIALSECURITYNUMBER") return "SSN";
  if (v === "EIN" || v === "FEIN" || v === "EMPLOYERIDENTIFICATIONNUMBER") return "EIN";
  if (v === "ITIN") return "ITIN";
  if (v === "ATIN") return "ATIN";
  return null;
}
function maskTin(tin) {
  if (!tin) return null;
  const last4 = tin.digits.slice(-4);
  return tin.type === "EIN" ? `**-***${last4}` : `***-**-${last4}`;
}
function formatTin(tin, type) {
  const d = tin.digits;
  return type === "EIN" ? `${d.slice(0, 2)}-${d.slice(2)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

// src/decide.ts
function money(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars2 = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars2}.${String(abs % 100).padStart(2, "0")}`;
}
var dollars = (n) => `$${n.toLocaleString("en-US")}`;
function classifyEntity(label, name) {
  const t = (label ?? "").toLowerCase();
  if (t) {
    if (/exempt|501\s*\(?c|non-?profit|government|municipal|\bstate of\b|federal agency/.test(t))
      return { class: "tax_exempt", inferred: false };
    if (/partnership|\bp\b$|llc[\s-]*p\b|sole|individual|single[- ]member|disregarded|smllc|trust|estate/.test(
      t
    ))
      return { class: "not_corporation", inferred: false };
    if (/\bc\b|\bs\b|corp|c-corp|s-corp|incorporated|\binc\b|llc[\s-]*[cs]\b/.test(t))
      return { class: "corporation", inferred: false };
    if (/^llc$|limited liability/.test(t)) return { class: "unknown", inferred: false };
  }
  if (/\b(inc|incorporated|corp|corporation|p\.?c|pllc)\.?$/i.test(name.trim().replace(/[,]/g, "")))
    return { class: name.match(/pllc\.?$/i) ? "unknown" : "corporation", inferred: true };
  return { class: "unknown", inferred: true };
}
function w9Status(info) {
  if (info.w9 === true) return "on_file";
  if (info.w9 === false) return "missing";
  if (info.tin) return "on_file";
  return info.tinUnreadable ? "missing" : "unknown";
}
function sum(payments, pick) {
  return payments.filter(pick).reduce((n, p) => n + p.cents, 0);
}
function decide(info, payments, rules) {
  const forms = [];
  const notFiled = [];
  const checks = [];
  const entity = classifyEntity(info.entityLabel, info.name);
  const w9 = w9Status(info);
  const total = sum(payments, () => true);
  const corp = entity.class === "corporation";
  const viaK = payments.filter((p) => p.method !== "direct");
  const kCents = sum(viaK, () => true);
  if (kCents > 0) {
    const labels = [...new Set(viaK.map((p) => p.methodLabel).filter(Boolean))].join(", ");
    const network = viaK.some((p) => p.method === "network");
    notFiled.push({
      what: "card_or_network",
      cents: kCents,
      reason: `${money(kCents)} paid by ${labels || (network ? "a payment network" : "card")}: reported on Form 1099-K by the card company or payment network, not on your 1099-NEC or 1099-MISC` + (network ? ", even when the network files no 1099-K because the payee is under its threshold. A personal (friends-and-family) transfer is not a payment-network transaction; if that is how it was paid, mark it so and it counts as yours." : "."),
      cites: network ? ["payment-card", "k-de-minimis"] : ["payment-card"]
    });
  }
  const direct = payments.filter((p) => p.method === "direct");
  const goods = sum(direct, (p) => p.kind === "goods");
  if (goods > 0)
    notFiled.push({
      what: "goods",
      cents: goods,
      reason: `${money(goods)} for merchandise and similar items: not reported.`,
      cites: ["merchandise"]
    });
  if (entity.class === "tax_exempt") {
    const rest = sum(direct, (p) => p.kind !== "goods");
    if (rest > 0)
      notFiled.push({
        what: "tax_exempt",
        cents: rest,
        reason: `${money(rest)} to a tax-exempt organization or government (${info.entityLabel}): not reported.`,
        cites: ["tax-exempt"]
      });
    return finish();
  }
  const services = sum(direct, (p) => p.kind === "services");
  const attorneyFees = sum(direct, (p) => p.kind === "attorney_fees");
  const corpExempt = corp ? services : 0;
  if (corpExempt > 0)
    notFiled.push({
      what: "corporation",
      cents: corpExempt,
      reason: `${money(corpExempt)} for services to a corporation (${entityWords()}): exempt.`,
      cites: ["corporation-exception"]
    });
  const nec = (corp ? 0 : services) + attorneyFees;
  const necThreshold = rules.necThreshold * 100;
  if (nec > 0) {
    const parts = [
      !corp && services > 0 ? `${money(services)} for services` : "",
      attorneyFees > 0 ? `${money(attorneyFees)} in attorney fees` : ""
    ].filter(Boolean);
    const what = parts.join(" and ");
    const cites = [rules.necCite];
    if (corp && attorneyFees > 0) cites.push("attorney-corporations");
    if (nec >= necThreshold) {
      forms.push({
        form: "1099-NEC",
        box: rules.necBox,
        kind: attorneyFees > 0 && services === 0 ? "attorney_fees" : "services",
        cents: nec,
        reason: `${what} is at least ${dollars(rules.necThreshold)}${corp && attorneyFees > 0 ? "; attorney fees are reported even to a corporation" : ""}.`,
        cites
      });
    } else if (info.withheldCents > 0) {
      forms.push({
        form: "1099-NEC",
        box: rules.necBox,
        kind: "services",
        cents: nec,
        reason: `${what} is under ${dollars(rules.necThreshold)}, but ${money(info.withheldCents)} of federal income tax was withheld, so it is reported regardless of the amount.`,
        cites: [...cites, "withholding-files"]
      });
    } else {
      const was2025 = rules.year === 2026 && nec >= RULES[2025].necThreshold * 100;
      notFiled.push({
        what: "under_threshold",
        cents: nec,
        reason: `${what} is under ${dollars(rules.necThreshold)}, the ${rules.year} threshold${was2025 ? `; at 2025's ${dollars(RULES[2025].necThreshold)} it would have needed a 1099-NEC` : ""}.`,
        cites: was2025 ? [rules.necCite, "threshold-change"] : [rules.necCite]
      });
    }
  }
  const miscCorpExempt = [];
  for (const rule of rules.misc) {
    const cents = sum(direct, (p) => p.kind === rule.kind);
    if (cents <= 0) continue;
    const exemptForCorp = corp && !["medical", "attorney_proceeds"].includes(rule.kind);
    if (exemptForCorp) {
      miscCorpExempt.push(rule.kind);
      notFiled.push({
        what: "corporation",
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} to a corporation (${entityWords()}): exempt.`,
        cites: ["corporation-exception"]
      });
      continue;
    }
    const cites = [rule.cite];
    if (corp && rule.kind === "medical") cites.push("medical-corporations");
    if (corp && rule.kind === "attorney_proceeds") cites.push("attorney-corporations");
    if (cents >= rule.threshold * 100) {
      forms.push({
        form: "1099-MISC",
        box: rule.box,
        kind: rule.kind,
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} is at least ${dollars(rule.threshold)}${corp ? "; reported even to a corporation" : ""}.`,
        cites
      });
    } else {
      notFiled.push({
        what: "under_threshold",
        cents,
        reason: `${money(cents)} in ${KIND_LABEL[rule.kind]} is under ${dollars(rule.threshold)}.`,
        cites
      });
    }
  }
  return finish();
  function entityWords() {
    return entity.inferred ? `the name says so; confirm on its W-9` : `${info.entityLabel ?? "corporation"}`;
  }
  function finish() {
    const files = forms.length > 0;
    if (files && w9 !== "on_file") {
      checks.push({
        text: w9 === "missing" ? "No W-9 on file: request one before you file. Without a TIN, backup withholding at 24% applies to further payments." : "No TIN in the file: confirm a W-9 is on file, or request one before you file.",
        cites: ["w9-request", "backup-withholding"]
      });
    }
    if (files && entity.class === "unknown" && !entity.inferred) {
      checks.push({
        text: "Entity type says LLC without its tax classification: the W-9's line 3 says whether it is taxed as a C or S corporation (exempt for services) or not.",
        cites: ["corporation-exception"]
      });
    } else if (files && entity.class === "unknown") {
      checks.push({
        text: "No entity type in the file: a W-9 showing a C or S corporation (including an LLC taxed as one) would make services and rents exempt.",
        cites: ["corporation-exception"]
      });
    }
    if (corp && entity.inferred && notFiled.some((n) => n.what === "corporation")) {
      checks.push({
        text: "Exempt only because the name ends in Inc or Corp: confirm the W-9 says C or S corporation.",
        cites: ["corporation-exception"]
      });
    }
    if (payments.some((p) => p.kindAssumed) && files)
      checks.push({
        text: "Nothing in the file said what some payments were for; they were counted as services.",
        cites: []
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
      totalCents: total
    };
  }
}
function assess(report, year) {
  const rules = RULES[year];
  const inYear = report.payments.filter((p) => !p.date || p.date.startsWith(`${year}-`));
  const otherYearPayments = report.payments.length - inYear.length;
  const byPayee = /* @__PURE__ */ new Map();
  for (const p of inYear) byPayee.set(p.payee, [...byPayee.get(p.payee) ?? [], p]);
  const decisions = [];
  for (const [name, payments] of byPayee) {
    const info = report.payees.get(name);
    decisions.push(decide(info, payments, rules));
  }
  decisions.sort(
    (a, b) => Number(b.status === "file") - Number(a.status === "file") || b.totalCents - a.totalCents || a.payee.localeCompare(b.payee)
  );
  return {
    year,
    rules,
    decisions,
    missingW9: decisions.filter((d) => d.status === "file" && d.w9 !== "on_file").map((d) => d.payee),
    otherYearPayments,
    assumedKindPayments: inYear.filter((p) => p.kindAssumed).length
  };
}

// src/csv.ts
function parseCsv(text) {
  const src = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// src/input.ts
var FIELDS = [
  "name",
  "dba",
  "amount",
  "method",
  "category",
  "date",
  "tin",
  "tin_type",
  "entity",
  "w9",
  "withheld",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "country"
];
var ALIASES = {
  name: [
    "vendor",
    "vendor name",
    "vendor display name",
    "payee",
    "payee name",
    "name",
    "contact",
    "contact name",
    "supplier",
    "supplier name",
    "recipient",
    "recipient name",
    "display name",
    "legal name",
    "company",
    "company name"
  ],
  dba: ["dba", "doing business as", "business name", "name line 2", "dba name"],
  amount: [
    "amount",
    "total",
    "amount paid",
    "paid",
    "payment amount",
    "payment",
    "total paid",
    "net amount",
    "gross amount",
    "debit"
  ],
  method: [
    "payment method",
    "method",
    "paid by",
    "paid via",
    "payment type",
    "transaction type",
    "payment account",
    "paid from",
    "source"
  ],
  category: [
    "account",
    "category",
    "expense account",
    "expense category",
    "gl account",
    "account name",
    "1099 box",
    "box",
    "1099 category",
    "1099 type",
    "type"
  ],
  date: ["date", "payment date", "transaction date", "paid date", "paid on"],
  tin: [
    "tin",
    "tax id",
    "tax id number",
    "taxpayer id",
    "taxpayer id number",
    "tax identification number",
    "taxpayer identification number",
    "federal id",
    "federal tax id",
    "business id no",
    "ein",
    "ssn",
    "ein ssn",
    "tin ein ssn"
  ],
  tin_type: ["tin type", "tax id type", "id type"],
  entity: [
    "entity",
    "entity type",
    "tax classification",
    "federal tax classification",
    "w 9 classification",
    "w9 classification",
    "business type",
    "vendor type"
  ],
  w9: [
    "w 9",
    "w9",
    "w 9 on file",
    "w9 on file",
    "w 9 received",
    "w9 received",
    "has w 9",
    "w 9 status",
    "w9 status"
  ],
  withheld: [
    "federal income tax withheld",
    "backup withholding",
    "federal withholding",
    "withheld",
    "tax withheld"
  ],
  address1: [
    "address",
    "address 1",
    "address line 1",
    "street",
    "street address",
    "billing address",
    "billing address line 1",
    "address1"
  ],
  address2: ["address 2", "address line 2", "suite", "billing address line 2", "address2"],
  city: ["city", "town", "city town", "billing city"],
  state: ["state", "st", "province", "region", "billing state"],
  zip: ["zip", "zip code", "postal code", "postcode", "billing zip", "billing postal code"],
  country: ["country", "billing country"]
};
function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function boxColumnKind(header) {
  const h = norm(header);
  if (/nonemployee|\bnec\b/.test(h)) return "services";
  if (/gross proceeds/.test(h)) return "attorney_proceeds";
  if (/attorney|legal/.test(h)) return "attorney_fees";
  if (/\brents?\b/.test(h)) return "rents";
  if (/royalt/.test(h)) return "royalties";
  if (/other income/.test(h)) return "other_income";
  if (/medical|health care/.test(h)) return "medical";
  return null;
}
var InputError = class extends Error {
  constructor(code, cause_, fix) {
    super(cause_);
    this.code = code;
    this.cause_ = cause_;
    this.fix = fix;
  }
  code;
  cause_;
  fix;
};
function parseMap(spec) {
  if (!spec) return {};
  const out = {};
  const parts = spec.match(/(?:[^,"]+|"[^"]*")+/g) ?? [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 1)
      throw new InputError(
        "BAD_MAP",
        `\`${part}\` in --map is not field=Header`,
        `Write --map like name=Vendor,amount="Amount Paid". Fields: ${FIELDS.join(", ")}.`
      );
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (!FIELDS.includes(key))
      throw new InputError(
        "BAD_MAP",
        `--map names \`${key}\`, which is not a field`,
        `Use only: ${FIELDS.join(", ")}.`
      );
    out[key] = value;
  }
  return out;
}
function parseMoney(raw) {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}
function kindFromText(text) {
  const t = norm(text);
  if (!t) return null;
  const box = boxColumnKind(text);
  if (box) return box;
  if (/\blaw\b|lawyer|counsel|attorney|legal/.test(t)) return "attorney_fees";
  if (/\brent|\blease|rental/.test(t)) return "rents";
  if (/royalt/.test(t)) return "royalties";
  if (/medical|health|physician|doctor|dental|clinic|therap/.test(t)) return "medical";
  if (/\bprize|\baward/.test(t)) return "other_income";
  if (/merchandise|inventory|cost of goods|\bcogs\b|freight|shipping|postage|telephone|phone service|office supplies|\bsupplies\b|storage/.test(
    t
  ))
    return "goods";
  if (/contract|consult|professional|service|freelanc|subcontract|design|develop|commission|\bfees?\b|labor|labour|outside|photograph|writing|translat|deliver|cleaning|repair|maintenance|marketing|bookkeeping|accounting|coaching|tutor|installation|landscap|janitorial|programming|video|editing/.test(
    t
  ))
    return "services";
  return null;
}
function methodFromText(text) {
  const t = norm(text);
  if (!t) return "direct";
  if (/friends? (and|&)? ?family|\bf f\b|personal/.test(t)) return "direct";
  if (/credit card|debit card|charge card|\bcard\b|visa|mastercard|master card|amex|american express|discover/.test(
    t
  ))
    return "card";
  if (/paypal|venmo|stripe|square|cash app|cashapp|shopify payments|etsy|amazon pay|google pay|apple pay|upwork|fiverr/.test(
    t
  ))
    return "network";
  return "direct";
}
function yesNo(raw) {
  const t = norm(raw);
  if (!t) return null;
  if (/^(y|yes|true|1|on file|received|collected|have|done)\b/.test(t)) return true;
  if (/^\d{4} \d{1,2} \d{1,2}$|^\d{1,2} \d{1,2} \d{2,4}$/.test(t)) return true;
  if (/^(n|no|false|0|missing|none|not|requested|pending)\b/.test(t)) return false;
  return null;
}
function parseDate(raw) {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t) && /[a-z]/i.test(s) && /\d{4}/.test(s))
    return new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  return null;
}
function findHeader(rows, map) {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map(norm);
    const columns = {};
    const taken = /* @__PURE__ */ new Set();
    for (const f of FIELDS) {
      const wanted = map[f];
      const idx = wanted ? cells.indexOf(norm(wanted)) : ALIASES[f].map((a) => cells.findIndex((c, i2) => c === a && !taken.has(i2))).find((i2) => i2 >= 0) ?? -1;
      if (idx >= 0) {
        columns[f] = idx;
        taken.add(idx);
      }
    }
    const boxes = rows[i].map((h, col) => ({ col, kind: boxColumnKind(h) })).filter(
      (b) => b.kind !== null && b.col !== columns.amount && b.col !== columns.category
    );
    if (columns.name === void 0 || columns.amount === void 0 && boxes.length === 0)
      continue;
    const amountIsTotal = columns.amount !== void 0 && /^total/.test(cells[columns.amount] ?? "") && !map.amount;
    const summary = boxes.length > 0 && (columns.amount === void 0 || amountIsTotal);
    if (summary) delete columns.amount;
    return { index: i, columns, boxes: summary ? boxes : [] };
  }
  return null;
}
var EMPTY_ADDRESS = { line1: "", line2: "", city: "", state: "", zip: "", country: "" };
function readReport(text, mapSpec) {
  const map = parseMap(mapSpec);
  const rows = parseCsv(text);
  const header = findHeader(rows, map);
  if (!header) {
    const missing = Object.entries(map).filter(([, h]) => !rows.slice(0, 25).some((r) => r.map(norm).includes(norm(h)))).map(([f, h]) => `${f}="${h}"`);
    throw new InputError(
      "NO_HEADER",
      missing.length ? `--map names columns this file does not have: ${missing.join(", ")}` : "found no header row with a payee column and an amount (or 1099 box) column in the first 25 rows",
      'Name the columns with --map, e.g. --map name="Vendor",amount="Amount", or export the 1099 or vendor payments report as CSV.'
    );
  }
  const { index, columns: cols, boxes } = header;
  const headerCells = rows[index];
  const cell = (r, f) => {
    const c = cols[f];
    return c === void 0 ? "" : (r[c] ?? "").trim();
  };
  const payments = [];
  const payees = /* @__PURE__ */ new Map();
  const skippedRows = [];
  let group = "";
  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i];
    const rowNo = i + 1;
    if (r.every((c) => c.trim() === "")) continue;
    const first = (r[0] ?? "").trim();
    const nameCell = cell(r, "name");
    if (/^total\b/i.test(first) || /^total\b/i.test(nameCell)) continue;
    const amountCells = boxes.length ? boxes.map((b) => ({ kind: b.kind, cents: parseMoney(r[b.col] ?? "") })) : [{ kind: null, cents: parseMoney(cell(r, "amount")) }];
    const anyAmount = amountCells.some((a2) => a2.cents !== null);
    if (!anyAmount) {
      const filled = r.filter((c) => c.trim() !== "");
      if (filled.length === 1 && first) group = first;
      else if (filled.length > 0) skippedRows.push({ row: rowNo, why: "no amount" });
      continue;
    }
    const payee = nameCell || group;
    if (!payee) {
      skippedRows.push({ row: rowNo, why: "no payee name" });
      continue;
    }
    let info = payees.get(payee);
    if (!info) {
      info = {
        name: payee,
        dba: null,
        tin: null,
        tinUnreadable: false,
        entityLabel: null,
        w9: null,
        withheldCents: 0,
        address: { ...EMPTY_ADDRESS }
      };
      payees.set(payee, info);
    }
    const tinRaw = cell(r, "tin");
    if (tinRaw && !info.tin) {
      const tin = parseTin(tinRaw, cell(r, "tin_type"));
      if (tin) info.tin = tin;
      else info.tinUnreadable = true;
    }
    info.dba ||= cell(r, "dba") || null;
    info.entityLabel ||= cell(r, "entity") || null;
    const w9 = yesNo(cell(r, "w9"));
    if (w9 !== null) info.w9 = info.w9 === true ? true : w9;
    info.withheldCents += Math.max(0, parseMoney(cell(r, "withheld")) ?? 0);
    const a = info.address;
    a.line1 ||= cell(r, "address1");
    a.line2 ||= cell(r, "address2");
    a.city ||= cell(r, "city");
    a.state ||= cell(r, "state");
    a.zip ||= cell(r, "zip");
    a.country ||= cell(r, "country");
    const methodText = cell(r, "method");
    const method = methodFromText(methodText);
    const categoryText = cell(r, "category");
    const date = parseDate(cell(r, "date"));
    for (const amt of amountCells) {
      if (amt.cents === null || amt.cents === 0) continue;
      const fromText = kindFromText(categoryText);
      const kind = amt.kind ?? fromText ?? "services";
      payments.push({
        payee,
        cents: amt.cents,
        kind,
        kindAssumed: amt.kind === null && fromText === null,
        method,
        methodLabel: methodText,
        date,
        row: rowNo
      });
    }
  }
  const columns = {};
  for (const f of FIELDS) {
    const c = cols[f];
    if (c !== void 0) columns[f] = headerCells[c] ?? "";
  }
  return {
    shape: boxes.length ? "summary" : "payments",
    headerRow: index + 1,
    columns,
    boxColumns: boxes.map((b) => ({ header: headerCells[b.col] ?? "", kind: b.kind })),
    payments,
    payees,
    skippedRows
  };
}

// src/iris.ts
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
var BATCH_SIZE = 100;
var LAYOUT_YEAR = 2025;
var COMMON_HEAD = [
  ["Form Type", "form_type"],
  ["Tax Year", "tax_year"],
  ["Payer TIN Type", "payer_tin_type"],
  ["Payer Taxpayer ID Number", "payer_tin"],
  ["Payer Name Type", "payer_name_type"],
  ["Payer Business or Entity Name Line 1", "payer_name1"],
  ["Payer Business or Entity Name Line 2", "payer_name2"],
  ["Payer First Name", "payer_first"],
  ["Payer Middle Name", "payer_middle"],
  ["Payer Last Name (Surname)", "payer_last"],
  ["Payer Suffix", "payer_suffix"],
  ["Payer Country", "payer_country"],
  ["Payer Address Line 1", "payer_address1"],
  ["Payer Address Line 2", "payer_address2"],
  ["Payer City/Town", "payer_city"],
  ["Payer State/Province/Territory", "payer_state"],
  ["Payer ZIP/Postal Code", "payer_zip"],
  ["Payer Phone Type", "payer_phone_type"],
  ["Payer Phone", "payer_phone"],
  ["Recipient TIN Type", "recipient_tin_type"],
  ["Recipient Taxpayer ID Number", "recipient_tin"],
  ["Recipient Name Type", "recipient_name_type"],
  ["Recipient Business or Entity Name Line 1", "recipient_name1"],
  ["Recipient Business or Entity Name Line 2", "recipient_name2"],
  ["Recipient First Name", "recipient_first"],
  ["Recipient Middle Name", "recipient_middle"],
  ["Recipient Last Name (Surname)", "recipient_last"],
  ["Recipient Suffix", "recipient_suffix"],
  ["Recipient Country", "recipient_country"],
  ["Recipient Address Line 1", "recipient_address1"],
  ["Recipient Address Line 2", "recipient_address2"],
  ["Recipient City/Town", "recipient_city"],
  ["Recipient State/Province/Territory", "recipient_state"],
  ["Recipient ZIP/Postal Code", "recipient_zip"],
  ["Office Code", "office_code"],
  ["Form Account Number", "account_number"]
];
var STATES = [1, 2].flatMap((n) => [
  [`State ${n}`, `state${n}_code`],
  [`State ${n} - State Tax Withheld`, `state${n}_withheld`],
  [`State ${n} - State/Payer state number`, `state${n}_number`],
  [`State ${n} - State income`, `state${n}_income`],
  [`State ${n} - Local income tax withheld`, `state${n}_local`],
  [`State ${n} - Special Data Entries`, `state${n}_special`]
]);
var NEC_COLUMNS = [
  ...COMMON_HEAD,
  ["2nd TIN Notice", "second_tin_notice"],
  ["Box 1 - Nonemployee Compensation", "nec_box1"],
  [
    "Box 2 - Payer made direct sales totaling $5,000 or more of consumer products to a recipient for resale",
    "nec_box2"
  ],
  ["Box 3 - Excess golden parachute payments", "nec_box3"],
  ["Box 4 - Federal income tax withheld", "box4_withheld"],
  ["Combined Federal/State Filing (CF/SF)", "cfsf"],
  ...STATES
];
var MISC_COLUMNS = [
  ...COMMON_HEAD,
  ["FATCA Filing Requirements", "fatca"],
  ["2nd TIN Notice", "second_tin_notice"],
  ["Box 1 - Rents", "misc_box1"],
  ["Box 2 - Royalties", "misc_box2"],
  ["Box 3 - Other income", "misc_box3"],
  ["Box 4 - Federal income tax withheld", "box4_withheld"],
  ["Box 5 - Fishing boat proceeds", "misc_box5"],
  ["Box 6 - Medical and health care payments", "misc_box6"],
  [
    "Box 7 - Direct sales of $5,000 or more of consumer products to a recipient for resale",
    "misc_box7"
  ],
  ["Box 8 - Substitute payments in lieu of dividends or interest", "misc_box8"],
  ["Box 9 - Crop insurance proceeds", "misc_box9"],
  ["Box 10 - Gross proceeds paid to an attorney", "misc_box10"],
  ["Box 11 - Fish purchased for resale", "misc_box11"],
  ["Box 12 - Section 409A deferrals", "misc_box12"],
  ["Box 15 - Nonqualified deferred compensation", "misc_box15"],
  ["Combined Federal/State Filing (CF/SF)", "cfsf"],
  ...STATES
];
var LAYOUTS = {
  "1099-NEC": NEC_COLUMNS,
  "1099-MISC": MISC_COLUMNS
};
function readPayer(json) {
  const o = json && typeof json === "object" ? json : {};
  const s = (k) => typeof o[k] === "string" ? o[k].trim() : "";
  const declared = s("tin_type").toUpperCase() === "SSN" ? "SSN" : "EIN";
  const tin = parseTin(s("tin"), declared);
  return {
    name: s("name"),
    name2: s("name_line2") || s("dba"),
    tin,
    tinType: tin?.type === "SSN" ? "SSN" : declared,
    country: s("country") || "US",
    address1: s("address1") || s("address"),
    address2: s("address2"),
    city: s("city"),
    state: s("state"),
    zip: s("zip"),
    phone: s("phone")
  };
}
function clean(value, allowed, max, what) {
  const kept = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").split("").map((ch) => allowed.test(ch) ? ch : ch === "." || ch === "," ? "" : " ").join("").replace(/\s+/g, " ").trim();
  const cut = kept.length > max ? kept.slice(0, max).trim() : kept;
  const notes = [];
  const removed = [...new Set(value.split("").filter((ch) => !allowed.test(ch) && ch !== " "))];
  if (removed.length) notes.push(`removed ${removed.map((c) => `"${c}"`).join(" ")}`);
  if (cut.length < kept.length) notes.push(`cut to ${max} characters`);
  return { value: cut, note: notes.length ? `${what}: ${notes.join(", ")}` : null };
}
var cleanName1 = (v, what = "name") => clean(v, /[A-Za-z0-9 \-#()&']/, 40, what);
var cleanName2 = (v, what = "name line 2") => clean(v, /[A-Za-z0-9 \-#()&'/%]/, 40, what);
var cleanAddress = (v, what = "address") => clean(v, /[A-Za-z0-9 \-/]/, 35, what);
var cleanCity = (v, what = "city") => clean(v, /[A-Za-z ]/, 40, what);
function cleanZip(v) {
  const digits = v.replace(/\D/g, "");
  return { value: digits, note: digits !== v.trim() && v.trim() ? `ZIP: kept the digits` : null };
}
function amount(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
function recipientTinType(tin, decision) {
  if (tin.type) return tin.type;
  return decision.entity.class === "not_corporation" && /individual|sole/i.test(decision.entity.label ?? "") ? "SSN" : "EIN";
}
function rowValues(form, year, payer, info, decision) {
  const fixed = [];
  const missing = [];
  const take = (c) => {
    if (c.note) fixed.push(c.note);
    return c.value;
  };
  const v = { form_type: form, tax_year: String(year) };
  if (payer) {
    v.payer_tin_type = payer.tinType;
    if (payer.tin) v.payer_tin = formatTin(payer.tin, payer.tinType);
    v.payer_name_type = "B";
    v.payer_name1 = take(cleanName1(payer.name, "payer name"));
    v.payer_name2 = take(cleanName2(payer.name2, "payer name line 2"));
    v.payer_country = payer.country;
    v.payer_address1 = take(cleanAddress(payer.address1, "payer address"));
    v.payer_address2 = take(cleanAddress(payer.address2, "payer address line 2"));
    v.payer_city = take(cleanCity(payer.city, "payer city"));
    v.payer_state = payer.state.toUpperCase();
    v.payer_zip = take(cleanZip(payer.zip));
    if (payer.phone) {
      v.payer_phone_type = "D";
      v.payer_phone = payer.phone.replace(/\D/g, "");
    }
  }
  if (info.tin) {
    const t = recipientTinType(info.tin, decision);
    v.recipient_tin_type = t;
    v.recipient_tin = formatTin(info.tin, t);
  }
  v.recipient_name_type = "B";
  v.recipient_name1 = take(cleanName1(info.name, "recipient name"));
  v.recipient_name2 = take(cleanName2(info.dba ?? "", "recipient name line 2"));
  v.recipient_country = (info.address.country || "US").toUpperCase().replace(/^USA$|^UNITED STATES.*$/, "US");
  v.recipient_address1 = take(cleanAddress(info.address.line1, "recipient address"));
  v.recipient_address2 = take(cleanAddress(info.address.line2, "recipient address line 2"));
  v.recipient_city = take(cleanCity(info.address.city, "recipient city"));
  v.recipient_state = info.address.state.trim().toUpperCase();
  v.recipient_zip = take(cleanZip(info.address.zip));
  v.second_tin_notice = "N";
  if (info.withheldCents > 0) v.box4_withheld = amount(info.withheldCents);
  if (form === "1099-NEC") {
    const line = decision.forms.find((f) => f.form === "1099-NEC");
    v.nec_box1 = amount(line.cents);
    v.nec_box2 = "N";
  } else {
    v.fatca = "N";
    v.misc_box7 = "N";
    for (const line of decision.forms.filter((f) => f.form === "1099-MISC")) {
      const key = `misc_box${line.box}`;
      v[key] = amount(line.cents);
    }
  }
  if (!payer) missing.push("payer (pass --payer payer.json)");
  else {
    if (!payer.tin) missing.push("payer TIN");
    if (!v.payer_name1) missing.push("payer name");
    if (!v.payer_address1 || !v.payer_city || !v.payer_state || !v.payer_zip)
      missing.push("payer address");
  }
  if (!info.tin) missing.push("recipient TIN (from the W-9)");
  if (!v.recipient_address1) missing.push("recipient address line 1");
  if (!v.recipient_city) missing.push("recipient city");
  if (v.recipient_country === "US") {
    if (!/^[A-Z]{2}$/.test(v.recipient_state ?? "")) missing.push("recipient state (2 letters)");
    if (![5, 9, 12].includes((v.recipient_zip ?? "").length))
      missing.push("recipient ZIP (5 or 9 digits)");
  }
  return { values: v, problem: { payee: info.name, form, missing, fixed } };
}
function readTemplate(text) {
  const header = parseCsv(text)[0] ?? [];
  const joined = header.map(norm).join("|");
  const form = /nonemployee/.test(joined) ? "1099-NEC" : /\brents\b/.test(joined) ? "1099-MISC" : null;
  if (!form)
    throw new Error(
      "the template's header row has neither a Nonemployee Compensation nor a Rents column; pass the 1099-NEC or 1099-MISC template downloaded from the IRIS Taxpayer Portal"
    );
  return { form, headers: header };
}
var strip = (h) => norm(h.replace(/\*/g, ""));
function layoutNote(year) {
  return year === LAYOUT_YEAR ? "TY2025 layout, from the IRS's TY2025 template formatting guidelines (updated 14 Jan 2026)." : `TY2025 layout with Tax Year ${year}: the IRS had not posted a TY${year} template when this version was released (latest: TY2025, updated 14 Jan 2026), and the December 2026 forms add boxes 1b\u20131d to the 1099-NEC and 13a, 13b and 14 to the 1099-MISC. Check these files against the TY${year} template in the portal before uploading, or rerun with --template.`;
}
function planIris(assessment, payees, payer, templates = []) {
  const problems = [];
  const rows = { "1099-NEC": [], "1099-MISC": [] };
  const header = {};
  const unmatched = {};
  const headerSource = {};
  const order = { "1099-NEC": [], "1099-MISC": [] };
  for (const form of ["1099-NEC", "1099-MISC"]) {
    const t = templates.find((x) => x.form === form);
    if (t) {
      const byName = new Map(LAYOUTS[form].map(([h, k]) => [strip(h), k]));
      header[form] = t.headers;
      order[form] = t.headers.map((h) => byName.get(strip(h)) ?? "");
      unmatched[form] = t.headers.filter((h) => !byName.has(strip(h)));
      headerSource[form] = "the template you passed with --template";
    } else {
      header[form] = LAYOUTS[form].map(([h]) => h);
      order[form] = LAYOUTS[form].map(([, k]) => k);
      headerSource[form] = "the field names in the IRS TY2025 template formatting guidelines";
    }
  }
  for (const d of assessment.decisions) {
    if (d.status !== "file") continue;
    const info = payees.get(d.payee);
    for (const form of ["1099-NEC", "1099-MISC"]) {
      if (!d.forms.some((f) => f.form === form)) continue;
      const { values, problem } = rowValues(form, assessment.year, payer, info, d);
      if (problem.missing.length || problem.fixed.length) problems.push(problem);
      rows[form].push(order[form].map((k) => k ? values[k] ?? "" : ""));
    }
  }
  const files = [];
  for (const form of ["1099-NEC", "1099-MISC"]) {
    const all = rows[form];
    const of = Math.ceil(all.length / BATCH_SIZE);
    for (let b = 0; b < of; b++)
      files.push({
        path: fileName(form, assessment.year, b + 1, of),
        form,
        records: Math.min(BATCH_SIZE, all.length - b * BATCH_SIZE),
        batch: b + 1,
        of
      });
  }
  return {
    plan: {
      layout: `TY${LAYOUT_YEAR}`,
      layoutNote: layoutNote(assessment.year),
      headerSource,
      batchSize: BATCH_SIZE,
      files,
      problems,
      unmatchedTemplateColumns: unmatched
    },
    rows,
    header
  };
}
function fileName(form, year, batch, of) {
  const layout = year === LAYOUT_YEAR ? "" : `_ty${LAYOUT_YEAR}-layout`;
  return `${form}_${year}${layout}_batch-${String(batch).padStart(2, "0")}-of-${String(of).padStart(2, "0")}.csv`;
}
function writeIris(dir, planned, disclaimer) {
  const { plan, rows, header } = planned;
  if (plan.files.length === 0) return [];
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const f of plan.files) {
    const start = (f.batch - 1) * BATCH_SIZE;
    const body = rows[f.form].slice(start, start + BATCH_SIZE);
    const full = path.join(dir, f.path);
    writeFileSync(full, toCsv([header[f.form], ...body]), { mode: 384 });
    written.push({ ...f, path: full });
  }
  const lines = [
    "iris-1099: IRIS Taxpayer Portal CSVs",
    disclaimer,
    "",
    plan.layoutNote,
    `Header row: ${Object.entries(plan.headerSource).map(([form, src]) => `${form} from ${src}`).join("; ")}.`,
    `At most ${plan.batchSize} records per file, the limit in the IRS's IRIS FAQ.`,
    "These files hold full TINs. They were written with owner-only permissions; keep them that way",
    "and delete them once the forms are filed.",
    "",
    "Upload: IRIS Taxpayer Portal > Upload CSV with Form Data, one form type per file."
  ];
  writeFileSync(path.join(dir, "LAYOUT.txt"), lines.join("\n") + "\n");
  return written;
}

// src/sources.ts
var SEEN = "2026-10-08";
var SOURCES = {
  "i1099mec-2026": {
    id: "i1099mec-2026",
    title: "Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026)",
    url: "https://www.irs.gov/instructions/i1099mec",
    revision: "Rev. December 2026; for 2026 information filed in early 2027",
    seen: SEEN
  },
  "i1099mec-2025": {
    id: "i1099mec-2025",
    title: "Instructions for Forms 1099-MISC and 1099-NEC (Rev. April 2025)",
    url: "https://www.irs.gov/pub/irs-prior/i1099mec--2025.pdf",
    revision: "Rev. April 2025; the revision for 2025 information",
    seen: SEEN
  },
  "i1099k-2026": {
    id: "i1099k-2026",
    title: "Instructions for Form 1099-K (Rev. December 2026)",
    url: "https://www.irs.gov/instructions/i1099k",
    revision: "Rev. December 2026",
    seen: SEEN
  },
  "p1099-2026": {
    id: "p1099-2026",
    title: "Publication 1099 (2026), General Instructions for Certain Information Returns",
    url: "https://www.irs.gov/pub/irs-pdf/p1099.pdf",
    revision: "2026",
    seen: SEEN
  },
  "iris-efile": {
    id: "iris-efile",
    title: "E-file information returns with IRIS",
    url: "https://www.irs.gov/filing/e-file-information-returns-with-iris",
    revision: "page last reviewed or updated 7 Oct 2026",
    seen: SEEN
  },
  "iris-ty2025-guidelines": {
    id: "iris-ty2025-guidelines",
    title: "IRIS CSV template formatting guidelines, tax year 2025 (ZIP)",
    url: "https://www.irs.gov/pub/irs-efile/ty2025-template-formatting-guidelines.zip",
    revision: "updated 14 Jan 2026; the newest tax year posted on 8 Oct 2026",
    seen: SEEN
  },
  "iris-faq": {
    id: "iris-faq",
    title: "Information Returns Intake System (IRIS) FAQs",
    url: "https://www.irs.gov/pub/irs-efile/info-returns-intake-system-faqs.pdf",
    revision: "PDF dated 10 Feb 2025",
    seen: SEEN
  },
  "iris-101-qa": {
    id: "iris-101-qa",
    title: "IRIS 101 questions and answers (5 Aug 2025)",
    url: "https://www.irs.gov/pub/irs-efile/irs-101-q-and-a-08052025.pdf",
    revision: "5 Aug 2025",
    seen: SEEN
  },
  fire: {
    id: "fire",
    title: "Filing Information Returns Electronically (FIRE)",
    url: "https://www.irs.gov/e-file-providers/filing-information-returns-electronically-fire",
    revision: "page last reviewed or updated 7 Aug 2026",
    seen: SEEN
  }
};
var CITATIONS = {
  "nec-2026": {
    source: "i1099mec-2026",
    quote: "File Form 1099-NEC, Nonemployee Compensation, for each person in the course of your business during the year to whom you have paid at least $2,000 in: 1. Services performed by someone who is not your employee (including parts and materials) (box 1a); or 2. Payments to an attorney (box 1a)."
  },
  "nec-2025": {
    source: "i1099mec-2025",
    quote: "File Form 1099-NEC, Nonemployee Compensation, for each person in the course of your business to whom you have paid the following during the year. \u2022 At least $600 in: 1. Services performed by someone who is not your employee (including parts and materials) (box 1); or 2. Payments to an attorney (box 1)."
  },
  "threshold-change": {
    source: "i1099mec-2026",
    quote: "For tax years beginning after 2025, the minimum threshold amount for reporting certain payments required to be reported on certain information returns and/or perform backup withholding on those payments increased to $2,000 and may be adjusted for inflation beginning in calendar year 2027."
  },
  "misc-royalties": {
    source: "i1099mec-2026",
    quote: "At least $10 in royalties (see the instructions for box 2) \u2026"
  },
  "misc-attorney-2026": {
    source: "i1099mec-2026",
    quote: "At least $600 in gross proceeds paid to an attorney (box 10) (see Payments to attorneys, later)."
  },
  "misc-2000-2026": {
    source: "i1099mec-2026",
    quote: "At least $2,000 in: 1. Rents (box 1); 2. Prizes and awards, including certain non-government grants (box 3); 3. Other income payments (box 3); \u2026 5. Medical and health care payments (box 6); \u2026"
  },
  "misc-600-2025": {
    source: "i1099mec-2025",
    quote: "At least $600 in: 1. Rents (box 1); 2. Prizes and awards, including certain non-government grants (box 3); 3. Other income payments (box 3); \u2026 6. Medical and health care payments (box 6); \u2026 8. Gross proceeds paid to an attorney (box 10) (see Payments to attorneys, later); \u2026"
  },
  "payment-card": {
    source: "i1099mec-2026",
    quote: "Payments made with a credit card or payment card and certain other types of payments, including third-party network transactions, must be reported on Form 1099-K by the payment settlement entity under section 6050W and are not subject to reporting on Form 1099-MISC or Form 1099-NEC."
  },
  "corporation-exception": {
    source: "i1099mec-2026",
    quote: "Generally, payments to a corporation (including a limited liability company (LLC) that is treated as a C or S corporation). However, see Reportable payments to corporations, earlier."
  },
  "attorney-corporations": {
    source: "i1099mec-2026",
    quote: "The exemption from reporting payments made to corporations does not apply to payments for legal services."
  },
  "medical-corporations": {
    source: "i1099mec-2026",
    quote: "The exemption from issuing Form 1099-MISC to a corporation does not apply to payments for medical or health care services provided by corporations, including professional corporations."
  },
  merchandise: {
    source: "i1099mec-2026",
    quote: "Payments for merchandise, telegrams, telephone, freight, storage, and similar items."
  },
  "tax-exempt": {
    source: "i1099mec-2026",
    quote: "Payments to a tax-exempt organization including tax-exempt trusts (IRAs, HSAs, Archer MSAs, Coverdell ESAs, and ABLE (529A) accounts), the United States, a state, the District of Columbia, a U.S. territory, or a foreign government."
  },
  "withholding-files": {
    source: "i1099mec-2026",
    quote: "You must also file Form 1099-NEC for each person from whom you have withheld any federal income tax (report in box 4) under the backup withholding rules regardless of the amount of the payment."
  },
  "nec-due": {
    source: "i1099mec-2026",
    quote: "Section 6071(c) requires you to file Form 1099-NEC on or before January 31, using either paper or electronic filing procedures."
  },
  "misc-due": {
    source: "i1099mec-2026",
    quote: "File Form 1099-MISC by February 28, if you file on paper, or March 31, if you file electronically."
  },
  "next-business-day": {
    source: "i1099mec-2026",
    quote: "If any date shown falls on a Saturday, Sunday, or legal holiday in the District of Columbia or where the return is to be filed, the due date is the next business day."
  },
  "w9-request": {
    source: "p1099-2026",
    quote: "If the recipient is a U.S. person (including a U.S. resident alien), the IRS suggests that you request the recipient complete Form W-9, Request for Taxpayer Identification Number and Certification; \u2026"
  },
  "backup-withholding": {
    source: "p1099-2026",
    quote: "Interest \u2026, dividends, rents, royalties, commissions, nonemployee compensation, and certain other payments \u2026 may be subject to backup withholding at a 24% rate."
  },
  "llc-disregarded": {
    source: "p1099-2026",
    quote: "For a single-member LLC (including a foreign LLC with a U.S. owner) that is disregarded as an entity separate from its owner under Regulations section 301.7701-3, enter the owner\u2019s name only on the first name line and the LLC\u2019s name on the second name line."
  },
  "tpso-threshold": {
    source: "i1099k-2026",
    quote: "A third party settlement organization (TPSO) is required to report payments in settlement of third party network transactions with any participating payee that exceed $20,000, and the total number of such transactions exceeds 200."
  },
  "k-6050w": {
    source: "i1099k-2026",
    quote: "Payments made by payment card or through a third party payment network after December 31, 2010, that otherwise would be reportable under sections 6041 (payments made in the course of a trade or business to another person) or 6041A(a) (payments of remuneration for services and certain direct sales) and 6050W are reported under section 6050W and not section 6041 or 6041A."
  },
  "k-de-minimis": {
    source: "i1099k-2026",
    quote: "For purposes of determining whether payments are subject to reporting under section 6050W, rather than section 6041 or 6041A, the de minimis threshold, discussed later under Box 1a, is disregarded."
  },
  "iris-100": {
    source: "iris-faq",
    quote: "Each CSV file holds up to 100 records, not including the header. You may submit an unlimited number of templates."
  },
  "iris-headers": {
    source: "iris-faq",
    quote: "The IRIS system validates the CSV column header descriptions. We recommend you download the newest templates to avoid errors when uploading CSV Files."
  },
  "iris-250": {
    source: "iris-101-qa",
    quote: "The current CSV files is 100 records per upload. Beginning TY25/PY26 the record size will increase to 250."
  },
  "fire-last-day": {
    source: "fire",
    quote: "Nov. 19, 2026, at 3 p.m. ET: Last day to file information returns through the FIRE system."
  },
  "iris-only": {
    source: "fire",
    quote: "IRIS will be the only information returns electronic filing system, including current year, prior year, or corrections, after Jan. 1, 2027."
  },
  "new-boxes-2026": {
    source: "i1099mec-2026",
    quote: "New boxes 1b and 13a. P.L. 119-21, section 70201, requires the reporting of cash tips. \u2026 New boxes 1c and 13b. Use the Treasury Tipped Occupation Code(s) to identify the tipped occupation(s) for Forms 1099-NEC and 1099-MISC. \u2026 New boxes 1d and 14. P.L. 119-21, Section 70202(a), requires the reporting of overtime compensation."
  }
};
var SAME_IN_2025 = /* @__PURE__ */ new Set([
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
  "next-business-day"
]);
function cite(id, year) {
  const c = CITATIONS[id];
  const sourceId = year === 2025 && SAME_IN_2025.has(id) ? "i1099mec-2025" : c.source;
  const s = SOURCES[sourceId];
  return { quote: c.quote, source: s.title, url: s.url, seen: s.seen };
}
var DISCLAIMER = "Prepared for your review, not tax advice.";

// src/version.ts
import { readFileSync } from "fs";
var cached;
function version() {
  if (cached !== void 0) return cached;
  try {
    cached = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    cached = "0.0.0";
  }
  return cached;
}

// src/waitlist.ts
var SITE = "https://agentwares.vercel.app";
var WAITLIST_OFFER = "Keep every client's 1099 season \u2014 W-9 status, decisions, IRIS batch receipts \u2014 in one place.";
var WAITLIST_PRICE = "$15 per client per season, $49 minimum";
var WAITLIST_STATUS = `Not built yet: ${WAITLIST_PRICE}, built only if enough bookkeepers ask by 1 December 2026.`;
var WAITLIST_CLI_URL = `${SITE}/1099/waitlist/cli`;
var WAITLIST_PAGE_URL = `${SITE}/1099/waitlist`;
var PAGES_URL = `${SITE}/1099`;

// src/report.ts
function buildReport(file, parsed, assessment, plan, written) {
  const order = [];
  const n = (id) => {
    let i = order.indexOf(id);
    if (i < 0) i = order.push(id) - 1;
    return i + 1;
  };
  const { rules } = assessment;
  n(rules.necCite);
  for (const m of rules.misc) n(m.cite);
  const payees = assessment.decisions.map((d) => ({
    name: d.payee,
    status: d.status,
    forms: d.forms.map((f) => ({
      form: f.form,
      box: f.box,
      amount: money(f.cents),
      reason: f.reason,
      cite: f.cites.map(n)
    })),
    not_filed: d.notFiled.map((x) => ({
      what: x.what,
      amount: money(x.cents),
      reason: x.reason,
      cite: x.cites.map(n)
    })),
    checks: d.checks.map((c) => ({ text: c.text, cite: c.cites.map(n) })),
    entity: d.entity.label,
    entity_class: d.entity.class,
    w9: d.w9,
    tin: d.tinMasked,
    total_paid: money(d.totalCents)
  }));
  const deadlines = [
    {
      date: "2026-11-19",
      what: "FIRE takes its last filing (3 p.m. ET); file anything still due through FIRE before then, or use IRIS",
      cite: [n("fire-last-day")]
    },
    {
      date: "2027-01-01",
      what: "IRIS becomes the only system for information returns, including prior years and corrections",
      cite: [n("iris-only")]
    },
    {
      date: rules.due.nec,
      what: `1099-NEC for ${rules.year} payments due to the IRS (${rules.due.necNote})`,
      cite: [n("nec-due"), n("next-business-day")]
    },
    {
      date: rules.due.miscElectronic,
      what: `1099-MISC for ${rules.year} payments due to the IRS when filed electronically`,
      cite: [n("misc-due")]
    }
  ];
  n("iris-100");
  n("iris-headers");
  if (rules.year !== 2025) n("new-boxes-2026");
  const formsOf = (form) => assessment.decisions.filter((d) => d.forms.some((f) => f.form === form)).length;
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
      payments_assumed_services: assessment.assumedKindPayments
    },
    thresholds: {
      nec: `$${rules.necThreshold.toLocaleString("en-US")} (box ${rules.necBox})`,
      misc: rules.misc.map((m) => ({
        box: m.box,
        what: KIND_LABEL[m.kind],
        at_least: `$${m.threshold.toLocaleString("en-US")}`
      }))
    },
    summary: {
      payees: payees.length,
      need_a_form: payees.filter((p) => p.status === "file").length,
      no_form: payees.filter((p) => p.status === "no_form").length,
      to_check: payees.filter((p) => p.checks.length > 0).length,
      missing_w9: assessment.missingW9.length,
      forms_1099_nec: formsOf("1099-NEC"),
      forms_1099_misc: formsOf("1099-MISC")
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
        records: f.records
      })),
      fix_before_upload: plan.problems.filter((p) => p.missing.length).map((p) => ({ payee: p.payee, form: p.form, missing: p.missing })),
      cleaned: plan.problems.filter((p) => p.fixed.length).map((p) => ({ payee: p.payee, form: p.form, changes: p.fixed })),
      unmatched_template_columns: plan.unmatchedTemplateColumns
    },
    deadlines,
    citations: order.map((id, i) => ({ n: i + 1, id, ...cite(id, rules.year) })),
    waitlist: {
      offer: WAITLIST_OFFER,
      price: WAITLIST_PRICE,
      status: WAITLIST_STATUS,
      url: WAITLIST_CLI_URL
    }
  };
}

// src/check.ts
function checkYear(year) {
  if (!isYear(year))
    throw new InputError(
      "UNSUPPORTED_YEAR",
      year > 2026 ? `${year}: the IRS says the $2,000 threshold "may be adjusted for inflation beginning in calendar year 2027" and has not published the ${year} amounts` : `${year}: only 2025 and 2026 payments are covered`,
      `Use --year ${YEARS.join(" or --year ")}.`
    );
}
function runCheck(opts) {
  checkYear(opts.year);
  const parsed = readReport(opts.text, opts.map);
  const assessment = assess(parsed, opts.year);
  const templates = (opts.templates ?? []).map((t) => {
    try {
      return readTemplate(readFileSync2(t, "utf8"));
    } catch (err) {
      throw new InputError(
        "BAD_TEMPLATE",
        `${t}: ${err instanceof Error ? err.message : String(err)}`,
        "Pass the CSV template downloaded from the IRIS Taxpayer Portal (Upload CSV with Form Data)."
      );
    }
  });
  const planned = planIris(assessment, parsed.payees, opts.payer ?? null, templates);
  const files = opts.outDir ? writeIris(opts.outDir, planned, DISCLAIMER) : null;
  return buildReport(
    opts.label,
    parsed,
    assessment,
    planned.plan,
    opts.outDir && files ? { dir: opts.outDir, files } : null
  );
}

// src/mcp.ts
import { readFileSync as readFileSync3, statSync } from "fs";
import path2 from "path";
import { createInterface } from "readline";

// src/install.ts
var ON_NPM = false;
var NAME = "iris-1099";
var REPO = `https://github.com/agentwares/${NAME}`;
var INSTALL = ON_NPM ? `npx ${NAME}` : `npx --allow-git=root github:agentwares/${NAME}`;
var RUN = ON_NPM ? `npx -y ${NAME}@latest` : `npx -y --allow-git=root github:agentwares/${NAME}`;

// src/mcp.ts
var MAX_BYTES = 20 * 1024 * 1024;
var TOOLS = [
  {
    name: "iris1099_check_payees",
    title: "Which payees need a 1099",
    description: "Reads a vendor-payments or 1099 report on this machine (a QuickBooks or Xero export, or any CSV with a payee column and an amount column) and decides, payee by payee, who needs a Form 1099-NEC or 1099-MISC for 2025 or 2026 payments and why: the $600 threshold for 2025 payments and $2,000 for 2026; card and payment-network (PayPal, Venmo, Stripe) amounts left to the 1099-K; corporations exempt except for attorney fees, attorneys' gross proceeds and medical payments; merchandise never reported. Returns each decision with its reason and the IRS sentence it applies (numbered citations with URL and the date read), the payees still missing a W-9, how many IRIS Taxpayer Portal CSV records and batches of 100 the CLI would write, any row the portal would reject and why, and the filing dates (FIRE's last day 19 Nov 2026; IRIS only from 1 Jan 2027). TINs come back as their last four digits only. Reads the file and nothing else: no network, no writes. Output is prepared for review, not tax advice.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Path to the CSV on this machine, absolute or relative to the server's working directory: a QuickBooks or Xero 1099, vendor-payments or transaction-detail export, or any CSV with one row per payment (payee and amount) or one row per payee with a column per 1099 box."
        },
        year: {
          type: "integer",
          enum: [...YEARS],
          description: "The calendar year the payments were made in: 2025 applies the $600 thresholds, 2026 the $2,000 ones. Payments dated in another year are left out. Omitted: the current year from July on, the previous year before."
        },
        column_map: {
          type: "string",
          minLength: 3,
          description: `Which header holds which field, when the file's headers are not the usual names: comma-separated field=Header pairs, e.g. name=Supplier,amount="Paid out",method="Paid via". Fields: name, dba, amount, method, category, date, tin, tin_type, entity, w9, withheld, address1, address2, city, state, zip, country. Omitted: columns are found by their names.`
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    annotations: {
      title: "Which payees need a 1099",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
];
function invalid(cause, fix) {
  throw new InputError("INVALID_INPUT", cause, fix);
}
function checkArgs(args) {
  if (args === void 0 || args === null) invalid("`path` is required", "Pass the CSV's path.");
  if (typeof args !== "object" || Array.isArray(args))
    invalid("arguments must be an object", "Pass { path, year?, column_map? }.");
  const props = TOOLS[0].inputSchema.properties;
  const a = args;
  for (const k of Object.keys(a))
    if (!props[k])
      invalid(`unknown argument \`${k}\``, `Use only: ${Object.keys(props).join(", ")}.`);
  if (typeof a.path !== "string" || a.path.trim() === "")
    invalid("`path` must be a non-empty string", "Pass the CSV's path.");
  if (a.year !== void 0 && (typeof a.year !== "number" || !Number.isInteger(a.year)))
    invalid("`year` must be an integer", `Pass ${YEARS.join(" or ")}.`);
  if (a.column_map !== void 0 && typeof a.column_map !== "string")
    invalid("`column_map` must be a string", "Write it like name=Vendor,amount=Total.");
  return a;
}
function callTool(name, rawArgs, ctx = {}) {
  if (name !== "iris1099_check_payees") throw new Error(`unknown tool ${name}`);
  try {
    const args = checkArgs(rawArgs);
    const file = path2.resolve(ctx.cwd ?? process.cwd(), args.path);
    let size;
    try {
      size = statSync(file).size;
    } catch {
      throw new InputError(
        "FILE_NOT_FOUND",
        `no file at ${file}`,
        "Pass the path of the exported CSV; relative paths resolve against the server's working directory."
      );
    }
    if (size > MAX_BYTES)
      throw new InputError(
        "FILE_TOO_LARGE",
        `${file} is ${Math.round(size / 1024 / 1024)} MB; the tool reads up to ${MAX_BYTES / 1024 / 1024} MB`,
        "Export one year of vendor payments, or the 1099 summary report."
      );
    const report = runCheck({
      label: path2.basename(file),
      text: readFileSync3(file, "utf8"),
      year: args.year ?? defaultYear(ctx.now?.() ?? /* @__PURE__ */ new Date()),
      map: args.column_map,
      outDir: null
    });
    const { iris, ...rest } = report;
    return {
      structured: {
        ...rest,
        iris: {
          ...iris,
          files_written: false,
          write_with: `${RUN} ${JSON.stringify(file)} --year ${report.year} --payer payer.json`
        }
      },
      isError: false
    };
  } catch (err) {
    const body = err instanceof InputError ? { code: err.code, cause: err.cause_, fix: err.fix, retryable: false } : {
      code: "INTERNAL",
      cause: err instanceof Error ? err.message : String(err),
      fix: "Run iris-1099 on the same file in a terminal to see the error with its context, and report it at https://github.com/agentwares/iris-1099/issues.",
      retryable: false
    };
    return { structured: { ...body }, isError: true };
  }
}
export {
  BATCH_SIZE,
  CITATIONS,
  DISCLAIMER,
  FIELDS,
  InputError,
  MISC_COLUMNS,
  NEC_COLUMNS,
  RULES,
  SOURCES,
  TOOLS,
  YEARS,
  assess,
  buildReport,
  callTool,
  cite,
  classifyEntity,
  decide,
  maskTin,
  parseMap,
  planIris,
  readPayer,
  readReport,
  runCheck,
  writeIris
};
//# sourceMappingURL=index.js.map