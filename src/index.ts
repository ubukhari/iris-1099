/** The library: the same rules, reader, decisions and IRIS writer the CLI uses. */
export { runCheck, type CheckOptions } from "./check.js";
export { assess, decide, classifyEntity, type Assessment, type Decision } from "./decide.js";
export { readReport, parseMap, FIELDS, InputError, type ParsedReport } from "./input.js";
export { planIris, writeIris, readPayer, BATCH_SIZE, NEC_COLUMNS, MISC_COLUMNS } from "./iris.js";
export { buildReport, type Report } from "./report.js";
export { RULES, YEARS, type Year, type YearRules } from "./rules.js";
export { CITATIONS, SOURCES, DISCLAIMER, cite } from "./sources.js";
export { maskTin } from "./tin.js";
export { TOOLS, callTool } from "./mcp.js";
