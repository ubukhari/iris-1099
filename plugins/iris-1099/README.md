# iris-1099

Who needs a 1099 for 2025 or 2026 payments, explained inside Claude Code from your own books.

- `/iris-1099:iris-1099 <report.csv>` runs `npx -y --allow-git=root github:agentwares/iris-1099` on a QuickBooks,
  Xero or any vendor-payments CSV and explains who needs a 1099-NEC or 1099-MISC and why ($600 for
  2025 payments, $2,000 for 2026), what goes on the 1099-K instead, which corporations are exempt,
  the missing W-9s, and the IRIS Taxpayer Portal CSVs it wrote, in batches of 100.

## What it runs, reads and sends

- **Runs** one command, through the Bash tool. The skill pre-approves nothing, so Claude Code asks
  you before the command runs.
- **Fetches** iris-1099 with `npx`, from where that command names. It has no dependencies.
- **Reads** the report you name, and writes the IRIS CSVs into `iris-1099-<year>` in the folder
  it runs in, with owner-only permissions.
- **Sends nothing.** The command makes no network request. No LLM calls of its own, no
  telemetry, no account. TINs are written only into the IRIS CSVs on your disk; everything shown
  in the conversation is the last four digits.

Every decision cites the IRS sentence it applies, with the date it was read. Prepared for your
review, not tax advice.

Source, the full CLI and its documentation: [github.com/agentwares/iris-1099](https://github.com/agentwares/iris-1099).
MIT licensed, by agentwares.
