import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";
import {
  InputError,
  kindFromText,
  methodFromText,
  parseDate,
  parseMap,
  parseMoney,
  readReport,
} from "./input.js";
import { maskTin, parseTin, redactTins } from "./tin.js";

describe("csv", () => {
  it("reads quoted commas, doubled quotes, CRLF and a byte-order mark, and writes them back", () => {
    const text = '﻿Name,Amount\r\n"Acme, Inc.","1,200.00"\r\n"Say ""hi""",5\r\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      ["Name", "Amount"],
      ["Acme, Inc.", "1,200.00"],
      ['Say "hi"', "5"],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("values", () => {
  it("money as reports write it", () => {
    expect(parseMoney("$1,234.56")).toBe(123456);
    expect(parseMoney("(250.00)")).toBe(-25000);
    expect(parseMoney("-80")).toBe(-8000);
    expect(parseMoney("USD 10")).toBe(1000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });

  it("dates as reports write them", () => {
    expect(parseDate("2026-03-14")).toBe("2026-03-14");
    expect(parseDate("03/14/2026")).toBe("2026-03-14");
    expect(parseDate("3/4/26")).toBe("2026-03-04");
    expect(parseDate("")).toBeNull();
  });

  it("how it was paid: card, payment network, or direct", () => {
    expect(methodFromText("Credit card (Visa)")).toBe("card");
    expect(methodFromText("AMEX")).toBe("card");
    expect(methodFromText("PayPal")).toBe("network");
    expect(methodFromText("Venmo business")).toBe("network");
    expect(methodFromText("PayPal friends and family")).toBe("direct");
    expect(methodFromText("Zelle")).toBe("direct");
    expect(methodFromText("ACH")).toBe("direct");
    expect(methodFromText("Check")).toBe("direct");
    expect(methodFromText("")).toBe("direct");
  });

  it("what it was for, from an account or category", () => {
    expect(kindFromText("Legal & professional fees:Legal")).toBe("attorney_fees");
    expect(kindFromText("Rent or lease")).toBe("rents");
    expect(kindFromText("Contract labor")).toBe("services");
    expect(kindFromText("Office supplies")).toBe("goods");
    expect(kindFromText("Box 1 - Nonemployee Compensation")).toBe("services");
    expect(kindFromText("Gross proceeds paid to an attorney")).toBe("attorney_proceeds");
    expect(kindFromText("Medical")).toBe("medical");
    expect(kindFromText("Miscellaneous")).toBeNull();
  });

  it("--map", () => {
    expect(parseMap('name=Supplier,amount="Paid out, net"')).toEqual({
      name: "Supplier",
      amount: "Paid out, net",
    });
    expect(() => parseMap("payee=Supplier")).toThrow(InputError);
  });
});

describe("TINs", () => {
  it("are read, typed by their shape, and masked to the last four", () => {
    const ein = parseTin("00-0001234");
    expect(ein).toEqual({ digits: "000001234", type: "EIN" });
    expect(maskTin(ein)).toBe("**-***1234");
    const ssn = parseTin("100-00-5678");
    expect(ssn?.type).toBe("SSN");
    expect(maskTin(ssn)).toBe("***-**-5678");
    expect(parseTin("912-70-1234")?.type).toBe("ITIN");
    expect(parseTin("12345")).toBeNull();
    expect(parseTin("100005678", "EIN")?.type).toBe("EIN");
  });

  it("the print guard masks any nine-digit run", () => {
    expect(redactTins("TIN 100-00-5678 and 00-0001234 and 100005678")).toBe(
      "TIN *****5678 and *****1234 and *****5678",
    );
    expect(redactTins("on 2026-10-08, $18,000.00, 5555550100")).toBe(
      "on 2026-10-08, $18,000.00, 5555550100",
    );
  });
});

describe("reports", () => {
  it("a QuickBooks-style detail report: title rows, vendor group headings, Total rows", () => {
    const csv = [
      "SYNTHETIC test company",
      "1099 Transaction Detail Report",
      "January - December 2026",
      "",
      ",Date,Transaction Type,Num,Name,Account,Amount",
      "Harbor Lane Design LLC,,,,,,",
      ",02/15/2026,Bill Payment (Check),101,,Contract labor,1600.00",
      ",05/15/2026,Bill Payment (Check),102,,Contract labor,1600.00",
      "Total for Harbor Lane Design LLC,,,,,,3200.00",
      "Quill and Ledger,,,,,,",
      ",03/15/2026,Expense,,,Professional fees,850.00",
      "Total for Quill and Ledger,,,,,,850.00",
      "TOTAL,,,,,,4050.00",
    ].join("\n");
    const r = readReport(csv);
    expect(r.shape).toBe("payments");
    expect(r.headerRow).toBe(5);
    expect(r.payments.map((p) => [p.payee, p.cents, p.kind])).toEqual([
      ["Harbor Lane Design LLC", 160000, "services"],
      ["Harbor Lane Design LLC", 160000, "services"],
      ["Quill and Ledger", 85000, "services"],
    ]);
  });

  it("a 1099 summary with a column per box, whose Total column is not double counted", () => {
    const csv = [
      "Vendor,Tax ID,Box 1 Nonemployee Compensation,Rents,Royalties,Medical and Health Care Payments,Total",
      "Ridgeback Properties LLC,00-0001008,,18000.00,,,18000.00",
      "Calloway Ines,100-00-1012,2500,,450,,2950",
    ].join("\n");
    const r = readReport(csv);
    expect(r.shape).toBe("summary");
    expect(r.payments.map((p) => [p.payee, p.kind, p.cents])).toEqual([
      ["Ridgeback Properties LLC", "rents", 1800000],
      ["Calloway Ines", "services", 250000],
      ["Calloway Ines", "royalties", 45000],
    ]);
    expect(r.payees.get("Calloway Ines")?.tin?.type).toBe("SSN");
  });

  it("Payment Method beats Transaction Type for how it was paid", () => {
    const r = readReport(
      "Date,Transaction Type,Vendor,Payment Method,Amount\n01/01/2026,Expense,A,PayPal,10\n",
    );
    expect(r.columns.method).toBe("Payment Method");
    expect(r.payments[0]?.method).toBe("network");
  });

  it("--map names columns the aliases do not know", () => {
    const csv = "Supplier,Paid out,Paid via\nTern Street,2750,Zelle\n";
    expect(() => readReport(csv)).toThrow(InputError);
    const r = readReport(csv, 'name=Supplier,amount="Paid out",method="Paid via"');
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({ payee: "Tern Street", cents: 275000, method: "direct" });
  });

  it("says what is wrong when no header row is found", () => {
    try {
      readReport("a,b\n1,2\n");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InputError);
      expect((err as InputError).code).toBe("NO_HEADER");
      expect((err as InputError).fix).toContain("--map");
    }
  });
});
