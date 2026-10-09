---
name: iris-1099
description: Decide which vendors and contractors need a Form 1099-NEC or 1099-MISC for 2025 or 2026 payments - the $600 threshold for 2025 payments and $2,000 for 2026, card and PayPal or Venmo amounts left to the 1099-K, corporations exempt except attorneys and medical payments, merchandise never reported - and list missing W-9s and write IRIS Taxpayer Portal CSVs, by running iris-1099 on the user's own QuickBooks, Xero or vendor-payments CSV. Use when the user asks who needs a 1099, whether a vendor or LLC needs one, about the 2026 $2,000 threshold, about IRIS CSV uploads, or about FIRE ending.
argument-hint: "<report.csv> [--year 2025|2026] [--payer payer.json] [--map name=Vendor,amount=Total]"
---

# Who needs a 1099

iris-1099 (MIT, [source](https://github.com/agentwares/iris-1099)) reads a vendor-payments or 1099
report on this machine and applies the payment year's rules, each cited to the IRS sentence it
comes from. It makes no network calls and sends nothing anywhere. Its output is prepared for the
user's review, not tax advice; say so when you summarise it.

Run it with the Bash tool (Claude Code asks the user to approve the command; this skill pre-approves
nothing). With no report yet, `--demo` shows it on invented vendors:

```sh
npx -y --allow-git=root github:agentwares/iris-1099 $ARGUMENTS
```

Then explain it in plain words:

1. **Who needs which form and why**: the form and box, the amount, and the reason with its IRS
   citation number. For 2026 payments the threshold is $2,000; for 2025 payments it was $600.
2. **Who does not, and why**: card and payment-network amounts (PayPal, Venmo, Stripe) are the
   network's to report on the 1099-K, even when the network files none; services to a corporation
   are exempt, but attorney fees and medical payments are not; merchandise is never reported.
3. **What to check**: missing W-9s (a 1099 needs the payee's TIN), and payees whose entity type
   the file does not say. An LLC needs its W-9 line 3 classification to decide.
4. **The IRIS files**: where they were written, any row the portal would reject and what it is
   missing. For 2026 payments the IRS has not posted its template yet; the files use the 2025
   layout and say so.

Never show or repeat a full TIN: the CLI prints only the last four digits, and the IRIS CSVs it
writes hold the full ones on the user's disk. Do not file, upload or send anything on the user's
behalf.
