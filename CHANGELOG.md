# Changelog

## 0.1.0 (2026-10-08)

Who needs a 1099 for 2025 or 2026 payments, and IRIS-ready CSVs, from your own books.

- Reads a QuickBooks or Xero 1099 or vendor-payments export, or any CSV with a payee and an amount
  column (or a column per 1099 box); title rows, vendor group headings and Total rows are skipped,
  and `--map` names columns with other headers.
- Applies the payment year's rules, each cited to the IRS sentence it comes from with the date it
  was read: $600 for 2025 payments and $2,000 for 2026 (1099-NEC box 1, then box 1a); 1099-MISC
  rents, other income and medical at the same thresholds, royalties at $10 and attorneys' gross
  proceeds at $600; card and payment-network amounts left to the 1099-K; corporations exempt
  except attorney fees, attorneys' gross proceeds and medical payments; merchandise never reported;
  withholding reported whatever the amount.
- Lists payees who need a form and have no W-9, and those whose entity type the file leaves open.
- Writes IRIS Taxpayer Portal CSVs, one form per file and at most 100 records each, in the IRS's
  TY2025 layout; values are cleaned to the characters and lengths the IRS's formatting guidelines
  allow, and rows the portal would reject are listed. The TY2026 template is not posted yet, so
  2026 files say they use the 2025 layout. `--template` writes under the exact header row of a
  template downloaded from the portal.
- `--json`, `--year`, `--demo` (invented vendors), `--payer`, `--no-files`, `--quiet`.
- `iris-1099 mcp`: a local stdio MCP server with one read-only tool, `iris1099_check_payees`.
- TINs are written only into the IRIS CSVs on your disk, with owner-only permissions, and are
  shown everywhere else as the last four digits. No network, no LLM, no runtime dependencies.
- Every output says "Prepared for your review, not tax advice."
