/**
 * SYNTHETIC vendors for `--demo`, the tests and the README's recorded run: invented businesses
 * and people, invented addresses, and TINs that cannot belong to anyone — every SSN has 00 as its
 * middle group, which the Social Security Administration never issues, and every EIN starts 00,
 * which is not an IRS prefix. Laid out like a QuickBooks vendor-payments export, title rows and
 * all, and built so that each rule in src/rules.ts decides at least one payee.
 */
import type { Year } from "./rules.js";

export const SYNTHETIC_LABEL = "SYNTHETIC demo data: invented vendors, not anyone's books";

interface Vendor {
  name: string;
  entity: string;
  tin: string;
  w9: "Yes" | "No" | "";
  address: [street: string, city: string, state: string, zip: string];
  /** month, account, payment method, amount */
  payments: [number, string, string, number][];
}

const VENDORS: readonly Vendor[] = [
  {
    name: "Harbor Lane Design LLC",
    entity: "Single-member LLC",
    tin: "100-00-1001",
    w9: "Yes",
    address: ["12 Example Wharf, Suite 3", "Anytown", "ME", "04001"],
    payments: [
      [2, "Contract labor", "ACH", 1600],
      [5, "Contract labor", "ACH", 1600],
      [9, "Contract labor", "ACH", 1600],
    ],
  },
  {
    name: "Quill & Ledger Copywriting",
    entity: "Individual/sole proprietor",
    tin: "100-00-1002",
    w9: "Yes",
    address: ["48 Sample Ave", "Anytown", "OH", "43001"],
    payments: [
      [3, "Professional fees", "Check", 850],
      [8, "Professional fees", "Check", 600],
    ],
  },
  {
    name: "Northwind Office Supply, Inc.",
    entity: "C corporation",
    tin: "00-0001003",
    w9: "Yes",
    address: ["900 Placeholder Pkwy", "Anytown", "TX", "75001"],
    payments: [
      [1, "Office supplies", "Check", 1450],
      [6, "Office supplies", "Check", 1750],
    ],
  },
  {
    name: "Brightline Analytics Inc",
    entity: "C corporation",
    tin: "00-0001004",
    w9: "Yes",
    address: ["1 Demo Plaza Floor 12", "Anytown", "NY", "10001"],
    payments: [
      [4, "Consulting", "Wire", 6000],
      [10, "Consulting", "Wire", 6000],
    ],
  },
  {
    name: "Osei & Park LLP",
    entity: "Partnership",
    tin: "00-0001005",
    w9: "Yes",
    address: ["77 Fictional St", "Anytown", "IL", "60601"],
    payments: [[7, "Legal fees", "Check", 6500]],
  },
  {
    name: "Calder Legal PC",
    entity: "S corporation",
    tin: "00-0001006",
    w9: "Yes",
    address: ["5 Imaginary Ct", "Anytown", "CA", "90001"],
    payments: [[11, "Legal fees", "ACH", 3000]],
  },
  {
    name: "Juniper Physical Therapy PC",
    entity: "C corporation",
    tin: "00-0001007",
    w9: "Yes",
    address: ["310 Invented Rd", "Anytown", "CO", "80001"],
    payments: [[6, "Medical services", "Check", 2400]],
  },
  {
    name: "Ridgeback Properties LLC",
    entity: "LLC - Partnership",
    tin: "00-0001008",
    w9: "Yes",
    address: ["PO Box 1200", "Anytown", "WA", "98001"],
    payments: Array.from({ length: 12 }, (_, i): [number, string, string, number] => [
      i + 1,
      "Rent",
      "ACH",
      1500,
    ]),
  },
  {
    name: "Pixelwright Studio",
    entity: "Individual/sole proprietor",
    tin: "100-00-1009",
    w9: "Yes",
    address: ["22 Mock Ln", "Anytown", "OR", "97001"],
    payments: [
      [3, "Design services", "PayPal", 1300],
      [9, "Design services", "PayPal", 1300],
    ],
  },
  {
    name: "Dana Whitlock",
    entity: "Individual/sole proprietor",
    tin: "100-00-1010",
    w9: "Yes",
    address: ["8 Specimen Way", "Anytown", "GA", "30001"],
    payments: [
      [5, "Photography", "Credit card (Visa)", 2200],
      [12, "Photography", "Check", 1000],
    ],
  },
  {
    name: "Tern Street Translation",
    entity: "Individual/sole proprietor",
    tin: "",
    w9: "No",
    address: ["61 Example Blvd Apt 4", "Anytown", "FL", "33001"],
    payments: [
      [2, "Translation services", "Zelle", 1250],
      [8, "Translation services", "Zelle", 1500],
    ],
  },
  {
    name: "Ines Calloway",
    entity: "Individual/sole proprietor",
    tin: "100-00-1012",
    w9: "Yes",
    address: ["14 Sample Sq", "Anytown", "VT", "05001"],
    payments: [[12, "Royalties", "Check", 450]],
  },
  {
    name: "Cobalt Field Services LLC",
    entity: "LLC",
    tin: "00-0001013",
    w9: "Yes",
    address: ["400 Notreal Hwy", "Anytown", "AZ", "85001"],
    payments: [
      [4, "Subcontractors", "ACH", 2600],
      [10, "Subcontractors", "ACH", 2600],
    ],
  },
  {
    name: "Vela Courier Co",
    entity: "",
    tin: "",
    w9: "",
    address: ["3 Demo Dock", "Anytown", "NJ", "07001"],
    payments: [
      [1, "Delivery services", "Check", 1025],
      [7, "Delivery services", "Check", 1025],
    ],
  },
];

const HEADER = [
  "Date",
  "Transaction Type",
  "Vendor",
  "Account",
  "Payment Method",
  "Amount",
  "Tax ID",
  "Tax classification",
  "W-9 on file",
  "Address",
  "City",
  "State",
  "ZIP",
];

/** The synthetic vendor-payments export for one year, as CSV text. */
export function syntheticCsv(year: Year): string {
  const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    q(SYNTHETIC_LABEL),
    `Vendor payments, January-December ${year}`,
    "",
    HEADER.join(","),
  ];
  for (const v of VENDORS)
    for (const [month, account, method, amount] of v.payments)
      lines.push(
        [
          `${String(month).padStart(2, "0")}/15/${year}`,
          /card/i.test(method) ? "Expense" : "Bill Payment",
          v.name,
          account,
          method,
          amount.toFixed(2),
          v.tin,
          v.entity,
          v.w9,
          ...v.address,
        ]
          .map(q)
          .join(","),
      );
  lines.push(
    `TOTAL,,,,,${VENDORS.flatMap((v) => v.payments)
      .reduce((n, p) => n + p[3], 0)
      .toFixed(2)}`,
  );
  return lines.join("\n") + "\n";
}

/** The synthetic filer for the demo's IRIS files. */
export const SYNTHETIC_PAYER = {
  name: "Synthetic Demo Bakery LLC",
  tin: "00-0000100",
  tin_type: "EIN",
  address1: "1 Example Street",
  city: "Anytown",
  state: "TX",
  zip: "75001",
  phone: "5555550100",
};
