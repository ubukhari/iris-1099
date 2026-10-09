/**
 * How to run iris-1099: the one constant behind every place the command is shown or printed
 * (`--help` and the CLI's own lines, the README and its recorded run, the plugin skill and
 * marketplace, and the /1099 pages on agentwares.vercel.app).
 *
 * npm does not serve `iris-1099` yet, so it runs from the public repo, whose committed dist/ needs
 * no build (scripts/sync-oss-repos.sh). npm 12 refuses a git spec unless `--allow-git` permits it
 * ("Refusing to fetch"; its default is `none`); `root` permits only the spec named on the command
 * line, and npm 10 and 11 accept the flag (checked 8 Oct 2026), so the GitHub form carries it. The
 * day npm serves the package, flip ON_NPM and rewrite the rest:
 *
 *   IRIS_1099_WRITE=1 pnpm --filter iris-1099 exec vitest run src/distribution
 *
 * src/distribution.test.ts fails while any surface names another form of the command, including
 * the GitHub form without the flag.
 */
export const ON_NPM: boolean = false;

export const NAME = "iris-1099";
export const REPO = `https://github.com/agentwares/${NAME}`;

/** What a person types. */
export const INSTALL = ON_NPM ? `npx ${NAME}` : `npx --allow-git=root github:agentwares/${NAME}`;

/** What an agent runs unattended: no install prompt, and on npm the newest version, not a cached one. */
export const RUN = ON_NPM
  ? `npx -y ${NAME}@latest`
  : `npx -y --allow-git=root github:agentwares/${NAME}`;
