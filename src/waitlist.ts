/**
 * The paid path, day one: a waitlist for the hosted season record, which does not exist yet.
 *
 * The link goes to a page on agentwares.vercel.app whose page view is the count (the site's
 * existing beacon; no form, no cookie). The CLI's link has its own path so a CLI click and a page
 * click can be told apart. The price is the orchestrator's (brief DOOR-5); the record is built
 * only if at least 10 people click by 1 December 2026.
 */
export const SITE = "https://agentwares.vercel.app";

export const WAITLIST_OFFER =
  "Keep every client's 1099 season — W-9 status, decisions, IRIS batch receipts — in one place.";

export const WAITLIST_PRICE = "$15 per client per season, $49 minimum";

export const WAITLIST_STATUS = `Not built yet: ${WAITLIST_PRICE}, built only if enough bookkeepers ask by 1 December 2026.`;

/** Where the CLI's line points; the pages' button points at /1099/waitlist. */
export const WAITLIST_CLI_URL = `${SITE}/1099/waitlist/cli`;
export const WAITLIST_PAGE_URL = `${SITE}/1099/waitlist`;

/** The pages, for `--help` and the summary. */
export const PAGES_URL = `${SITE}/1099`;
