import { describe, expect, it } from "vitest";
import { assess, classifyEntity, decide, type Decision } from "./decide.js";
import { readReport, type PayeeInfo, type Payment } from "./input.js";
import { RULES } from "./rules.js";
import { syntheticCsv } from "./synthetic.js";

const info = (over: Partial<PayeeInfo> = {}): PayeeInfo => ({
  name: "Test Payee",
  dba: null,
  tin: { digits: "000001234", type: "EIN" },
  tinUnreadable: false,
  entityLabel: "Individual/sole proprietor",
  w9: true,
  withheldCents: 0,
  address: {
    line1: "1 Main St",
    line2: "",
    city: "Anytown",
    state: "TX",
    zip: "75001",
    country: "",
  },
  ...over,
});

const pay = (dollars: number, over: Partial<Payment> = {}): Payment => ({
  payee: "Test Payee",
  cents: Math.round(dollars * 100),
  kind: "services",
  kindAssumed: false,
  method: "direct",
  methodLabel: "Check",
  date: null,
  row: 2,
  ...over,
});

const forms = (d: Decision) => d.forms.map((f) => `${f.form} ${f.box} ${f.cents / 100}`);

describe("the threshold, by year", () => {
  it("2026: $2,000 exactly needs a 1099-NEC (box 1a); $1,999.99 does not", () => {
    expect(forms(decide(info(), [pay(2000)], RULES[2026]))).toEqual(["1099-NEC 1a 2000"]);
    const under = decide(info(), [pay(1999.99)], RULES[2026]);
    expect(under.status).toBe("no_form");
    expect(under.notFiled[0]?.reason).toContain("at 2025's $600 it would have needed a 1099-NEC");
    expect(under.notFiled[0]?.cites).toContain("threshold-change");
  });

  it("2025: $600 exactly needs a 1099-NEC (box 1); $599.99 does not", () => {
    expect(forms(decide(info(), [pay(600)], RULES[2025]))).toEqual(["1099-NEC 1 600"]);
    expect(decide(info(), [pay(599.99)], RULES[2025]).status).toBe("no_form");
  });

  it("refunds net against payments", () => {
    expect(decide(info(), [pay(2500), pay(-600)], RULES[2026]).status).toBe("no_form");
  });

  it("withholding makes it reportable whatever the amount", () => {
    const d = decide(info({ withheldCents: 12000 }), [pay(500)], RULES[2026]);
    expect(forms(d)).toEqual(["1099-NEC 1a 500"]);
    expect(d.forms[0]?.cites).toContain("withholding-files");
  });
});

describe("card and payment-network payments go to the 1099-K", () => {
  it("a card payment is left out, whatever the amount", () => {
    const d = decide(info(), [pay(9000, { method: "card", methodLabel: "Visa" })], RULES[2026]);
    expect(d.status).toBe("no_form");
    expect(d.notFiled[0]).toMatchObject({ what: "card_or_network", cites: ["payment-card"] });
  });

  it("PayPal goods-and-services is left out even under the network's own 1099-K threshold", () => {
    const d = decide(
      info(),
      [pay(2600, { method: "network", methodLabel: "PayPal" })],
      RULES[2026],
    );
    expect(d.status).toBe("no_form");
    expect(d.notFiled[0]?.cites).toEqual(["payment-card", "k-de-minimis"]);
    expect(d.notFiled[0]?.reason).toMatch(/friends-and-family/);
  });

  it("only the direct part counts toward the threshold", () => {
    const d = decide(
      info(),
      [pay(1500, { method: "card", methodLabel: "Amex" }), pay(1500)],
      RULES[2026],
    );
    expect(d.status).toBe("no_form");
    expect(d.notFiled.map((n) => n.what)).toEqual(["card_or_network", "under_threshold"]);
  });
});

describe("corporations", () => {
  const corp = info({ entityLabel: "C corporation" });

  it("services and rents to a corporation are exempt", () => {
    const d = decide(corp, [pay(12000), pay(5000, { kind: "rents" })], RULES[2026]);
    expect(d.status).toBe("no_form");
    expect(d.notFiled.every((n) => n.what === "corporation")).toBe(true);
  });

  it("attorney fees, attorneys' gross proceeds and medical payments are reported anyway", () => {
    const d = decide(
      corp,
      [
        pay(3000, { kind: "attorney_fees" }),
        pay(700, { kind: "attorney_proceeds" }),
        pay(2400, { kind: "medical" }),
      ],
      RULES[2026],
    );
    expect(forms(d)).toEqual(["1099-NEC 1a 3000", "1099-MISC 6 2400", "1099-MISC 10 700"]);
    expect(d.forms[0]?.cites).toContain("attorney-corporations");
    expect(d.forms.find((f) => f.box === "6")?.cites).toContain("medical-corporations");
  });

  it("the W-9's classification decides; a name ending in Inc is a corporation to confirm", () => {
    expect(classifyEntity("S corporation", "x").class).toBe("corporation");
    expect(classifyEntity("LLC - C", "x").class).toBe("corporation");
    expect(classifyEntity("LLC - S", "x").class).toBe("corporation");
    expect(classifyEntity("LLC - Partnership", "x").class).toBe("not_corporation");
    expect(classifyEntity("Single-member LLC", "x").class).toBe("not_corporation");
    expect(classifyEntity("Individual/sole proprietor", "x").class).toBe("not_corporation");
    expect(classifyEntity("LLC", "x")).toEqual({ class: "unknown", inferred: false });
    expect(classifyEntity("501(c)(3) exempt", "x").class).toBe("tax_exempt");
    expect(classifyEntity(null, "Northwind Office Supply, Inc.")).toEqual({
      class: "corporation",
      inferred: true,
    });
    expect(classifyEntity(null, "Calder Legal PC").class).toBe("corporation");
    expect(classifyEntity(null, "Cobalt Field Services LLC")).toEqual({
      class: "unknown",
      inferred: true,
    });
    const d = decide(
      info({ entityLabel: null, name: "Brightline Analytics Inc" }),
      [pay(5000)],
      RULES[2026],
    );
    expect(d.status).toBe("no_form");
    expect(d.checks.map((c) => c.text).join(" ")).toMatch(/confirm the W-9/);
  });

  it("an LLC whose classification is unknown is filed, with the question to settle", () => {
    const d = decide(info({ entityLabel: "LLC" }), [pay(5200)], RULES[2026]);
    expect(d.status).toBe("file");
    expect(d.checks[0]?.text).toMatch(/line 3/);
  });
});

describe("other exceptions", () => {
  it("merchandise is never reported", () => {
    const d = decide(info(), [pay(3200, { kind: "goods" })], RULES[2026]);
    expect(d.notFiled[0]).toMatchObject({ what: "goods", cites: ["merchandise"] });
  });

  it("tax-exempt organizations and governments are not reported", () => {
    const d = decide(info({ entityLabel: "Tax-exempt 501(c)(3)" }), [pay(9000)], RULES[2026]);
    expect(d.status).toBe("no_form");
    expect(d.notFiled[0]?.cites).toEqual(["tax-exempt"]);
  });
});

describe("W-9s", () => {
  it("a payee who needs a form and has no W-9 is listed, with the 24% warning", () => {
    const d = decide(info({ tin: null, w9: false }), [pay(2750)], RULES[2026]);
    expect(d.w9).toBe("missing");
    expect(d.checks[0]?.cites).toEqual(["w9-request", "backup-withholding"]);
  });
  it("a payee under the threshold is not chased for a W-9", () => {
    const d = decide(info({ tin: null, w9: false }), [pay(1000)], RULES[2026]);
    expect(d.checks).toEqual([]);
  });
});

describe("the synthetic vendors", () => {
  const summary = (year: 2025 | 2026) => {
    const a = assess(readReport(syntheticCsv(year)), year);
    return Object.fromEntries(
      a.decisions.map((d) => [
        d.payee,
        d.status === "file" ? forms(d) : d.notFiled.map((n) => n.what),
      ]),
    );
  };

  it("2026: every rule decides somebody", () => {
    expect(summary(2026)).toEqual({
      "Ridgeback Properties LLC": ["1099-MISC 1 18000"],
      "Osei & Park LLP": ["1099-NEC 1a 6500"],
      "Cobalt Field Services LLC": ["1099-NEC 1a 5200"],
      "Harbor Lane Design LLC": ["1099-NEC 1a 4800"],
      "Calder Legal PC": ["1099-NEC 1a 3000"],
      "Tern Street Translation": ["1099-NEC 1a 2750"],
      "Juniper Physical Therapy PC": ["1099-MISC 6 2400"],
      "Vela Courier Co": ["1099-NEC 1a 2050"],
      "Ines Calloway": ["1099-MISC 2 450"],
      "Brightline Analytics Inc": ["corporation"],
      "Dana Whitlock": ["card_or_network", "under_threshold"],
      "Northwind Office Supply, Inc.": ["goods"],
      "Pixelwright Studio": ["card_or_network"],
      "Quill & Ledger Copywriting": ["under_threshold"],
    });
  });

  it("2025: the $600 threshold catches the two the $2,000 one lets through", () => {
    const s = summary(2025);
    expect(s["Quill & Ledger Copywriting"]).toEqual(["1099-NEC 1 1450"]);
    expect(s["Dana Whitlock"]).toEqual(["1099-NEC 1 1000"]);
  });

  it("payments dated in another year are left out", () => {
    const a = assess(readReport(syntheticCsv(2026)), 2025);
    expect(a.decisions).toHaveLength(0);
    expect(a.otherYearPayments).toBeGreaterThan(20);
  });
});
