/**
 * `iris-1099 mcp`: a local MCP server over stdio with one tool, `iris1099_check_payees`, so an
 * agent can answer "which of these vendors need a 1099?" from a file on the user's machine.
 *
 * Implemented here rather than on the MCP SDK so the package has no runtime dependencies. It
 * speaks the initialize-based protocol revisions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05):
 * newline-delimited JSON-RPC on stdin/stdout, `initialize`, `ping`, `tools/list`, `tools/call`.
 * Any other method answers -32601. Nothing but protocol goes to stdout.
 *
 * The tool reads the file and writes nothing. What it returns goes to the agent's model provider
 * like any tool result, so it holds payee names, amounts and decisions, and TINs only as their
 * last four digits; the full TINs stay in the file. The IRIS CSVs, which need the full TINs, are
 * written by the CLI in a terminal, not by this tool.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { runCheck } from "./check.js";
import { InputError } from "./input.js";
import { RUN } from "./install.js";
import { defaultYear, YEARS } from "./rules.js";
import { version } from "./version.js";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
  annotations: {
    title: string;
    readOnlyHint: true;
    destructiveHint: false;
    idempotentHint: true;
    openWorldHint: false;
  };
}

/** Largest report the tool reads; a year's vendor payments for a small business is far below. */
export const MAX_BYTES = 20 * 1024 * 1024;

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "iris1099_check_payees",
    title: "Which payees need a 1099",
    description:
      "Reads a vendor-payments or 1099 report on this machine (a QuickBooks or Xero export, or any CSV with a payee column and an amount column) and decides, payee by payee, who needs a Form 1099-NEC or 1099-MISC for 2025 or 2026 payments and why: the $600 threshold for 2025 payments and $2,000 for 2026; card and payment-network (PayPal, Venmo, Stripe) amounts left to the 1099-K; corporations exempt except for attorney fees, attorneys' gross proceeds and medical payments; merchandise never reported. Returns each decision with its reason and the IRS sentence it applies (numbered citations with URL and the date read), the payees still missing a W-9, how many IRIS Taxpayer Portal CSV records and batches of 100 the CLI would write, any row the portal would reject and why, and the filing dates (FIRE's last day 19 Nov 2026; IRIS only from 1 Jan 2027). TINs come back as their last four digits only. Reads the file and nothing else: no network, no writes. Output is prepared for review, not tax advice.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description:
            "Path to the CSV on this machine, absolute or relative to the server's working directory: a QuickBooks or Xero 1099, vendor-payments or transaction-detail export, or any CSV with one row per payment (payee and amount) or one row per payee with a column per 1099 box.",
        },
        year: {
          type: "integer",
          enum: [...YEARS],
          description:
            "The calendar year the payments were made in: 2025 applies the $600 thresholds, 2026 the $2,000 ones. Payments dated in another year are left out. Omitted: the current year from July on, the previous year before.",
        },
        column_map: {
          type: "string",
          minLength: 3,
          description:
            'Which header holds which field, when the file\'s headers are not the usual names: comma-separated field=Header pairs, e.g. name=Supplier,amount="Paid out",method="Paid via". Fields: name, dba, amount, method, category, date, tin, tin_type, entity, w9, withheld, address1, address2, city, state, zip, country. Omitted: columns are found by their names.',
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      title: "Which payees need a 1099",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

export interface ToolError {
  code: string;
  cause: string;
  fix: string;
  retryable: boolean;
}

export interface McpContext {
  cwd?: string;
  now?: () => Date;
}

function invalid(cause: string, fix: string): never {
  throw new InputError("INVALID_INPUT", cause, fix);
}

function checkArgs(args: unknown): { path: string; year?: number; column_map?: string } {
  if (args === undefined || args === null) invalid("`path` is required", "Pass the CSV's path.");
  if (typeof args !== "object" || Array.isArray(args))
    invalid("arguments must be an object", "Pass { path, year?, column_map? }.");
  const props = TOOLS[0]!.inputSchema.properties;
  const a = args as Record<string, unknown>;
  for (const k of Object.keys(a))
    if (!props[k])
      invalid(`unknown argument \`${k}\``, `Use only: ${Object.keys(props).join(", ")}.`);
  if (typeof a.path !== "string" || a.path.trim() === "")
    invalid("`path` must be a non-empty string", "Pass the CSV's path.");
  if (a.year !== undefined && (typeof a.year !== "number" || !Number.isInteger(a.year)))
    invalid("`year` must be an integer", `Pass ${YEARS.join(" or ")}.`);
  if (a.column_map !== undefined && typeof a.column_map !== "string")
    invalid("`column_map` must be a string", "Write it like name=Vendor,amount=Total.");
  return a as { path: string; year?: number; column_map?: string };
}

export function callTool(
  name: string,
  rawArgs: unknown,
  ctx: McpContext = {},
): { structured: Record<string, unknown>; isError: boolean } {
  if (name !== "iris1099_check_payees") throw new Error(`unknown tool ${name}`);
  try {
    const args = checkArgs(rawArgs);
    const file = path.resolve(ctx.cwd ?? process.cwd(), args.path);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      throw new InputError(
        "FILE_NOT_FOUND",
        `no file at ${file}`,
        "Pass the path of the exported CSV; relative paths resolve against the server's working directory.",
      );
    }
    if (size > MAX_BYTES)
      throw new InputError(
        "FILE_TOO_LARGE",
        `${file} is ${Math.round(size / 1024 / 1024)} MB; the tool reads up to ${MAX_BYTES / 1024 / 1024} MB`,
        "Export one year of vendor payments, or the 1099 summary report.",
      );
    const report = runCheck({
      label: path.basename(file),
      text: readFileSync(file, "utf8"),
      year: args.year ?? defaultYear(ctx.now?.() ?? new Date()),
      map: args.column_map,
      outDir: null,
    });
    const { iris, ...rest } = report;
    return {
      structured: {
        ...rest,
        iris: {
          ...iris,
          files_written: false,
          write_with: `${RUN} ${JSON.stringify(file)} --year ${report.year} --payer payer.json`,
        },
      },
      isError: false,
    };
  } catch (err) {
    const body: ToolError =
      err instanceof InputError
        ? { code: err.code, cause: err.cause_, fix: err.fix, retryable: false }
        : {
            code: "INTERNAL",
            cause: err instanceof Error ? err.message : String(err),
            fix: "Run iris-1099 on the same file in a terminal to see the error with its context, and report it at https://github.com/agentwares/iris-1099/issues.",
            retryable: false,
          };
    return { structured: { ...body }, isError: true };
  }
}

interface Request {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const INSTRUCTIONS =
  "iris-1099 decides which payees in a local vendor-payments or 1099 report need a Form 1099-NEC or 1099-MISC for 2025 or 2026 payments, with the IRS sentence behind each decision. Read-only and local: it reads the file it is given and makes no network calls. TINs are returned as their last four digits. Its output is prepared for the user's review, not tax advice.";

export function handleMessage(msg: unknown, ctx: McpContext): unknown {
  if (Array.isArray(msg)) {
    const out = msg.map((m) => handleMessage(m, ctx)).filter((r) => r !== undefined);
    return out.length ? out : undefined;
  }
  const req = (msg && typeof msg === "object" ? msg : {}) as Request;
  const hasId = "id" in req && (typeof req.id === "string" || typeof req.id === "number");
  const id = hasId ? req.id : null;
  const error = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  if (!("method" in req) && ("result" in req || "error" in req)) return undefined;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string")
    return hasId || !("method" in req) ? error(-32600, "Invalid Request") : undefined;
  if (!hasId) return undefined; // notifications
  const params = (req.params && typeof req.params === "object" ? req.params : {}) as Record<
    string,
    unknown
  >;
  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "iris-1099", title: "iris-1099", version: version() },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !TOOLS.some((t) => t.name === name))
        return error(
          -32602,
          `Unknown tool: ${String(name)}. Tools: ${TOOLS.map((t) => t.name).join(", ")}`,
        );
      const { structured, isError } = callTool(name, params.arguments, ctx);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(structured) }],
          structuredContent: structured,
          isError,
        },
      };
    }
    default:
      return error(-32601, `Method not found: ${req.method}`);
  }
}

/** Serve on stdin/stdout until stdin closes. */
export async function serveStdio(ctx: McpContext = {}): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
      continue;
    }
    try {
      const res = handleMessage(msg, ctx);
      if (res !== undefined) process.stdout.write(JSON.stringify(res) + "\n");
    } catch (err) {
      process.stderr.write(`iris-1099 mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
