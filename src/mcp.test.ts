import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, describe, expect, it } from "vitest";
import { handleMessage, PROTOCOL_VERSIONS, TOOLS, type McpContext } from "./mcp.js";
import { DISCLAIMER } from "./sources.js";
import { syntheticCsv } from "./synthetic.js";

const tmp = mkdtempSync(path.join(tmpdir(), "iris-1099-mcp-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
writeFileSync(path.join(tmp, "payments.csv"), syntheticCsv(2026));
const ctx: McpContext = { cwd: tmp, now: () => new Date("2026-10-08T12:00:00Z") };

describe("the tool, as an agent reads it", () => {
  for (const tool of TOOLS) {
    it(`${tool.name}: namespaced, described, strict, read-only and closed-world`, () => {
      expect(tool.name).toMatch(/^iris1099_[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThanOrEqual(40);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      for (const [field, spec] of Object.entries(tool.inputSchema.properties)) {
        expect(typeof spec.description, field).toBe("string");
        expect((spec.description as string).length, field).toBeGreaterThan(20);
      }
      for (const r of tool.inputSchema.required ?? [])
        expect(tool.inputSchema.properties).toHaveProperty(r);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    });
    it(`${tool.name}: describes, does not instruct`, () => {
      expect(tool.description).not.toMatch(
        /\b(call this|use this tool|you should|always call|before calling)\b/i,
      );
    });
  }

  /**
   * scripts/check-tool-schemas.mjs reads deployed servers; this one runs on the user's machine, so
   * its own rules are run here instead, straight from the script's source.
   */
  const SCRIPT = new URL("../../../scripts/check-tool-schemas.mjs", import.meta.url);
  it.skipIf(!existsSync(SCRIPT))(
    "passes scripts/check-tool-schemas.mjs's findingsFor, unchanged",
    () => {
      const src = readFileSync(SCRIPT, "utf8");
      const min = /const MIN_DESCRIPTION = (\d+);/.exec(src)?.[1];
      const start = src.indexOf("function findingsFor(tool)");
      const end = src.indexOf("\nconst report");
      expect(min).toBeDefined();
      expect(start).toBeGreaterThan(0);
      const findingsFor = new Function(
        `const MIN_DESCRIPTION = ${min};\n${src.slice(start, end)}\nreturn findingsFor;`,
      )() as (tool: unknown) => string[];
      for (const tool of TOOLS) expect(findingsFor(tool), tool.name).toEqual([]);
      // and it does catch a bad one
      expect(
        findingsFor({ name: "check", description: "x", inputSchema: { properties: { a: {} } } })
          .length,
      ).toBeGreaterThan(2);
    },
  );
});

describe("protocol", () => {
  const rpc = (method: string, params?: unknown, id: number | null = 1) =>
    handleMessage(
      { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) },
      ctx,
    );

  it("negotiates a version it speaks", () => {
    for (const v of PROTOCOL_VERSIONS) {
      const res = rpc("initialize", { protocolVersion: v }) as {
        result: { protocolVersion: string };
      };
      expect(res.result.protocolVersion).toBe(v);
    }
    const future = rpc("initialize", { protocolVersion: "2099-01-01" }) as {
      result: { protocolVersion: string };
    };
    expect(future.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("answers ping, ignores notifications, refuses unknown methods and tools", () => {
    expect(rpc("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(rpc("notifications/initialized", undefined, null)).toBeUndefined();
    expect((rpc("server/discover") as { error: { code: number } }).error.code).toBe(-32601);
    expect((rpc("tools/call", { name: "nope" }) as { error: { code: number } }).error.code).toBe(
      -32602,
    );
  });
});

describe("over a real MCP client", () => {
  async function connect(): Promise<Client> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    serverSide.onmessage = (msg: JSONRPCMessage) => {
      const res = handleMessage(msg, ctx);
      if (res !== undefined) void serverSide.send(res as JSONRPCMessage);
    };
    await serverSide.start();
    const client = new Client({ name: "iris-1099-test", version: "1.0.0" });
    await client.connect(clientSide);
    return client;
  }

  it("decides the synthetic vendors, TINs masked, nothing written", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["iris1099_check_payees"]);
    const before = readdirSync(tmp);
    const res = await client.callTool({
      name: "iris1099_check_payees",
      arguments: { path: "payments.csv", year: 2026 },
    });
    expect(res.isError).toBe(false);
    const s = res.structuredContent as {
      disclaimer: string;
      summary: { need_a_form: number; missing_w9: number };
      payees: { name: string; tin: string | null }[];
      iris: { files_written: boolean; write_with: string; files: unknown[] };
    };
    expect(s.disclaimer).toBe(DISCLAIMER);
    expect(s.summary).toMatchObject({ need_a_form: 9, missing_w9: 2 });
    expect(s.payees.find((p) => p.name === "Harbor Lane Design LLC")?.tin).toBe("***-**-1001");
    expect(s.iris.files_written).toBe(false);
    expect(s.iris.files).toHaveLength(2);
    expect(readdirSync(tmp)).toEqual(before);
    const text = JSON.stringify(res);
    expect(text).not.toContain("100-00-1001");
    expect(text).not.toContain("00-0001005");
    await client.close();
  });

  it("an error carries code, cause, fix and retryable", async () => {
    const client = await connect();
    const missing = await client.callTool({
      name: "iris1099_check_payees",
      arguments: { path: "nope.csv" },
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ code: "FILE_NOT_FOUND", retryable: false });
    const extra = await client.callTool({
      name: "iris1099_check_payees",
      arguments: { path: "payments.csv", tin: "x" },
    });
    expect(extra.structuredContent).toMatchObject({ code: "INVALID_INPUT" });
    const year = await client.callTool({
      name: "iris1099_check_payees",
      arguments: { path: "payments.csv", year: 2027 },
    });
    expect(year.structuredContent).toMatchObject({ code: "UNSUPPORTED_YEAR" });
    await client.close();
  });
});
