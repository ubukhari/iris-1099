/**
 * The files that put iris-1099 where people already are: the package, the README and its recorded
 * run, the CHANGELOG, the repo-root files the sync copies from `distribution/root` (the Claude Code
 * plugin marketplace), and the mirror the /1099 pages on agentwares.vercel.app import. The public
 * repo has the root files at its root and no site, so those checks run in the monorepo only.
 *
 * After changing the CLI's output, rewrite the recorded run (docs/recorded-run.txt and the README
 * block) and the site's mirror:
 *
 *   pnpm --filter iris-1099 record
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { INSTALL, ON_NPM, REPO, RUN } from "./install.js";
import { main } from "./main.js";
import { DISCLAIMER } from "./sources.js";
import {
  PAGES_URL,
  WAITLIST_OFFER,
  WAITLIST_PAGE_URL,
  WAITLIST_PRICE,
  WAITLIST_STATUS,
} from "./waitlist.js";

const here = (rel: string): URL => new URL(`../${rel}`, import.meta.url);
const read = (rel: string): string => readFileSync(here(rel), "utf8");
const json = <T>(rel: string): T => JSON.parse(read(rel)) as T;
const WRITE = Boolean(process.env["IRIS_1099_WRITE"]);
const pkg = json<{
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  files: string[];
  bin: Record<string, string>;
  homepage: string;
}>("package.json");

/** The demo, run the way the README shows it, in an empty folder. */
async function recordedRun(): Promise<string> {
  const cwd = mkdtempSync(path.join(tmpdir(), "iris-1099-record-"));
  try {
    let out = "";
    const args = ["--demo", "--out", "iris-1099-demo"];
    const code = await main(args, {
      stdout: (s) => (out += s),
      stderr: (s) => (out += s),
      cwd,
      now: new Date("2026-10-08T12:00:00Z"),
    });
    const files = readdirSync(path.join(cwd, "iris-1099-demo")).sort();
    return [
      `$ ${INSTALL} ${args.join(" ")}`,
      out.trimEnd(),
      `(exit ${code})`,
      "",
      "$ ls iris-1099-demo",
      ...files,
      "",
    ].join("\n");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

let recording: string;
beforeAll(async () => {
  recording = await recordedRun();
});

describe("package", () => {
  it("has no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("ships the CLI and the files the README points at", () => {
    expect(pkg.name).toBe("iris-1099");
    expect(pkg.bin).toEqual({ "iris-1099": "./dist/cli.js" });
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "README.md", "CHANGELOG.md"]));
    expect(pkg.homepage).toBe(PAGES_URL);
  });

  it("CHANGELOG has a section for this version", () => {
    expect(read("CHANGELOG.md")).toMatch(
      new RegExp(`^## ${pkg.version.replace(/\./g, "\\.")} `, "m"),
    );
  });
});

// blank lines around the fence, as prettier writes them
const BLOCK = /<!-- recorded-run -->\n+```text\n[\s\S]*?```\n+<!-- \/recorded-run -->/;

describe("README", () => {
  it("leads with the one-line use and the disclaimer", () => {
    const readme = read("README.md");
    expect(readme).toContain("```sh\n" + INSTALL + " vendor-payments.csv\n```");
    expect(readme.slice(0, 1200)).toContain(DISCLAIMER);
  });

  it("carries the recorded run on synthetic vendors, which is the CLI's real output", () => {
    const block =
      "<!-- recorded-run -->\n\n```text\n" + recording + "```\n\n<!-- /recorded-run -->";
    if (WRITE) {
      writeFileSync(here("docs/recorded-run.txt"), recording);
      writeFileSync(here("README.md"), read("README.md").replace(BLOCK, block));
    }
    expect(read("docs/recorded-run.txt")).toBe(recording);
    expect(read("README.md")).toContain(block);
    expect(recording).toMatch(/^SYNTHETIC demo data/m);
    expect(recording).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b/);
  });

  it("cites the IRS with dates and names what it sends", () => {
    const readme = read("README.md");
    for (const url of [
      "https://www.irs.gov/instructions/i1099mec",
      "https://www.irs.gov/pub/irs-prior/i1099mec--2025.pdf",
      "https://www.irs.gov/filing/e-file-information-returns-with-iris",
      "https://www.irs.gov/e-file-providers/filing-information-returns-electronically-fire",
    ])
      expect(readme).toContain(url);
    expect(readme).toContain("8 October 2026");
    expect(readme).toContain("no network request");
    expect(readme).toContain(WAITLIST_PRICE);
  });
});

const root = "distribution/root";
const frontmatter = (text: string): Record<string, string> =>
  Object.fromEntries(
    (text.split("---")[1] ?? "")
      .split("\n")
      .map((l) => /^([a-z-]+):\s*(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!.replace(/^"|"$/g, "")]),
  );

describe.skipIf(!existsSync(here(root)))("repo-root files (distribution/root)", () => {
  it("the marketplace's plugin resolves, and its version matches this package", () => {
    const marketplace = json<{
      name: string;
      owner: { name: string };
      plugins: { name: string; source: string }[];
    }>(`${root}/.claude-plugin/marketplace.json`);
    expect(marketplace.name).toBe("iris-1099");
    expect(marketplace.owner.name).toBe("agentwares");
    expect(marketplace.plugins).toHaveLength(1);
    for (const entry of marketplace.plugins) {
      expect(entry.source.startsWith("./")).toBe(true);
      const plugin = json<{ name: string; version: string }>(
        `${root}/${entry.source.slice(2)}/.claude-plugin/plugin.json`,
      );
      expect(plugin.name).toBe(entry.name);
      expect(plugin.version).toBe(pkg.version);
    }
  });

  it("plugin.json links the page, the docs, the repository, privacy, terms and support", () => {
    const plugin = json<Record<string, string>>(
      `${root}/plugins/iris-1099/.claude-plugin/plugin.json`,
    );
    expect(plugin.homepage).toBe(pkg.homepage);
    expect(plugin.documentationUrl).toBe(`${REPO}#readme`);
    expect(plugin.repository).toBe(REPO);
    for (const k of ["privacyPolicyUrl", "termsOfServiceUrl", "supportUrl"])
      expect(plugin[k]).toMatch(/^https:\/\/agentwares\.vercel\.app\//);
    expect(plugin.license).toBe("MIT");
  });

  it("the one skill runs the CLI, and says the output is not tax advice", () => {
    expect(readdirSync(here(`${root}/plugins/iris-1099/skills`))).toEqual(["iris-1099"]);
    const text = read(`${root}/plugins/iris-1099/skills/iris-1099/SKILL.md`);
    const front = frontmatter(text);
    expect(front.name).toBe("iris-1099");
    expect(front.description!.length).toBeGreaterThan(80);
    expect(front.description!.length).toBeLessThanOrEqual(1024);
    expect(text).toContain(`${RUN} $ARGUMENTS`);
    expect(text).toContain("not tax advice");
  });

  it("no skill or manifest pre-approves a tool: Claude Code asks before every command", () => {
    const walk = (dir: string): string[] =>
      readdirSync(here(dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const files = walk(`${root}/plugins`);
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const text = read(f);
      const front = text.startsWith("---") ? (text.split("---")[1] ?? "") : "";
      expect(front, f).not.toMatch(/^\s*(allowed-tools|allowedTools)\s*:/m);
    }
    for (const f of [
      ...files.filter((x) => x.endsWith(".json")),
      `${root}/.claude-plugin/marketplace.json`,
    ])
      expect(read(f), f).not.toMatch(/allowed-?tools/i);
  });

  it("the listing icon is a 1024 px square PNG drawn from distribution/icon.svg (`pnpm icon`)", () => {
    const plugin = json<{ icon?: string }>(`${root}/plugins/iris-1099/.claude-plugin/plugin.json`);
    expect(plugin.icon).toBe("./.claude-plugin/icon.png");
    const file = `${root}/plugins/iris-1099/${plugin.icon!.slice(2)}`;
    const png = readFileSync(here(file));
    expect(statSync(here(file)).size).toBeLessThan(2 * 1024 * 1024);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    const key = "iris-1099-icon-source-sha256\0";
    const at = png.indexOf(key, 0, "latin1");
    expect(at, "icon.png carries no source hash: run `pnpm icon`").toBeGreaterThan(0);
    const drawnFrom = png.subarray(at + key.length, at + key.length + 64).toString("latin1");
    const svg = createHash("sha256").update(read("distribution/icon.svg")).digest("hex");
    expect(drawnFrom, "distribution/icon.svg changed: run `pnpm icon`").toBe(svg);
  });

  it("the plugin folder has the README the directory lists it by, naming what it runs", () => {
    const readme = read(`${root}/plugins/iris-1099/README.md`);
    expect(readme.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(readme).toContain(RUN);
    expect(readme).toContain("pre-approves nothing");
  });
});

/**
 * One install command (src/install.ts), everywhere it is shown. Any form of it found elsewhere must
 * be INSTALL, or RUN where an agent runs it unattended; code imports it rather than spell it. After
 * flipping ON_NPM, rewrite the files that cannot import it:
 *
 *   IRIS_1099_WRITE=1 pnpm --filter iris-1099 exec vitest run src/distribution
 */
const COMMAND =
  /npx (?:-{1,2}[\w-]+(?:=[\w-]+)? )*(?:github:agentwares\/)?iris-1099(?:@latest)?(?![\w./-])/g;
const forms = (text: string): string[] => [...text.matchAll(COMMAND)].map((m) => m[0]);
const walk = (rel: string): string[] =>
  !existsSync(here(rel))
    ? []
    : statSync(here(rel)).isFile()
      ? [rel]
      : readdirSync(here(rel), { withFileTypes: true })
          .filter((e) => !["node_modules", "dist", ".next"].includes(e.name))
          .flatMap((e) => walk(`${rel}/${e.name}`));

describe("the install command", () => {
  it(`is ${INSTALL} while ON_NPM is ${String(ON_NPM)}`, () => {
    expect(INSTALL).toBe(`npx ${ON_NPM ? "" : "--allow-git=root github:agentwares/"}${pkg.name}`);
    expect(RUN).toBe(
      ON_NPM
        ? `npx -y ${pkg.name}@latest`
        : `npx -y --allow-git=root github:agentwares/${pkg.name}`,
    );
    expect(REPO).toBe(`https://github.com/agentwares/${pkg.name}`);
  });

  /**
   * npm 12 refuses a git spec unless --allow-git permits it ("Refusing to fetch"), so the GitHub
   * form without the flag is a command that does not run. Nothing may show it: not the constants,
   * not this package's files, not the /1099 pages, not the monorepo's notes about the door.
   */
  const UNFLAGGED = /npx (?:(?:-y|--yes) )?github:agentwares\/iris-1099(?![\w./-])/;
  it("never shows the GitHub form without --allow-git, which npm 12 refuses", () => {
    if (!ON_NPM)
      for (const form of [INSTALL, RUN]) expect(form).toContain("--allow-git=root github:");
    for (const form of [INSTALL, RUN]) expect(form).not.toMatch(UNFLAGGED);
    const bare = `github:agentwares/${pkg.name}`;
    expect(`npx ${bare} --demo`).toMatch(UNFLAGGED);
    expect(`npx -y ${bare}`).toMatch(UNFLAGGED);
    const files = [
      "README.md",
      "CHANGELOG.md",
      "docs/recorded-run.txt",
      ...walk("distribution"),
      ...walk("src"),
      ...walk("scripts"),
      ...walk("../site/src/app/1099"),
      ...walk("../../docs/CHANGELOG.md"),
      ...walk("../../docs/reports/DOOR-5.md"),
      ...walk("../../scripts/sync-oss-repos.sh"),
    ].filter((f) => /\.(md|json|txt|ts|tsx|mjs|sh)$/.test(f));
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) expect(read(file), file).not.toMatch(UNFLAGGED);
  });

  const docs = [
    "README.md",
    "CHANGELOG.md",
    "docs/recorded-run.txt",
    ...walk("distribution"),
    ...walk(".claude-plugin"),
    ...walk("plugins"),
  ].filter((f) => /\.(md|json|txt)$/.test(f));

  it.each(docs)("%s names only INSTALL or RUN", (file) => {
    const text = read(file);
    if (WRITE) {
      const next = text.replace(COMMAND, (m) => (/ (?:-y|--yes) /.test(m) ? RUN : INSTALL));
      if (next !== text) writeFileSync(here(file), next);
    }
    for (const form of forms(read(file))) expect([INSTALL, RUN], file).toContain(form);
  });

  it("code, scripts and tests import it rather than spell it", () => {
    const files = [...walk("src"), ...walk("scripts")].filter((f) => f !== "src/install.ts");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(forms(read(file)), file).toEqual([]);
  });
});

/** The /1099 pages import a mirror of src/install.ts and src/waitlist.ts, written here. */
const SITE = "../site/src/app/1099";
const MIRROR = `${SITE}/_install.ts`;
describe.skipIf(!existsSync(here(SITE)))(
  "the command and the waitlist on agentwares.vercel.app/1099",
  () => {
    it("the mirror the pages import is src/install.ts and src/waitlist.ts", () => {
      // laid out the way prettier would, so the generated file passes `prettier --check`
      const decl = (name: string, value: string, type = "") => {
        const one = `export const ${name}${type} = ${value};`;
        return one.length <= 100 ? one : `export const ${name}${type} =\n  ${value};`;
      };
      const text = [
        "/**",
        " * How to run iris-1099 and what the waitlist says, mirrored from the CLI's src/install.ts and",
        " * src/waitlist.ts. Written by apps/iris-1099-cli/src/distribution.test.ts, which fails when",
        " * they differ: `pnpm --filter iris-1099 record`.",
        " */",
        decl("ON_NPM", String(ON_NPM), ": boolean"),
        decl("INSTALL", JSON.stringify(INSTALL)),
        decl("REPO", JSON.stringify(REPO)),
        decl("DISCLAIMER", JSON.stringify(DISCLAIMER)),
        decl("WAITLIST_OFFER", JSON.stringify(WAITLIST_OFFER)),
        decl("WAITLIST_PRICE", JSON.stringify(WAITLIST_PRICE)),
        decl("WAITLIST_STATUS", JSON.stringify(WAITLIST_STATUS)),
        decl("WAITLIST_PATH", JSON.stringify(new URL(WAITLIST_PAGE_URL).pathname)),
        "",
      ].join("\n");
      if (WRITE) writeFileSync(here(MIRROR), text);
      expect(read(MIRROR)).toBe(text);
    });

    it("no other page file spells the command", () => {
      const files = walk(SITE).filter((f) => f !== MIRROR && /\.(tsx?|md|txt|json)$/.test(f));
      expect(files.length).toBeGreaterThan(4);
      for (const file of files) expect(forms(read(file)), file).toEqual([]);
    });
  },
);
