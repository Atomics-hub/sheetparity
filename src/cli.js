import fs from "node:fs/promises";
import path from "node:path";
import { testWorkbook } from "./runner.js";
import { renderHuman } from "./reporters/human.js";
import { renderHtml } from "./reporters/html.js";

const HELP = `SheetParity — CI for generated XLSX files

Usage:
  sheetparity test <file.xlsx> [options]

Options:
  --matrix <ids>       Comma-separated adapters (default: libreoffice)
                       libreoffice, excel-web, google-sheets, onlyoffice, excel-desktop
  --json <path|->      Write normalized machine-readable result
  --html <path>        Write a standalone human report
  --policy <path>      JSON materiality overrides
  --soffice <path>     Exact LibreOffice executable
  --timeout <ms>       Engine timeout (default: 60000)
  -h, --help           Show help
  -v, --version        Show version

Exit codes: 0 pass, 1 material failure, 2 usage/internal error, 3 incomplete requested matrix.
`;

function parseArgs(argv) {
  const options = { matrix: "libreoffice", timeoutMs: 60_000 };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") { positional.push(...argv.slice(index + 1)); break; }
    if (!arg.startsWith("-")) { positional.push(arg); continue; }
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "-v" || arg === "--version") options.version = true;
    else if (["--matrix", "--json", "--html", "--policy", "--soffice", "--timeout"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--matrix") options.matrix = value;
      if (arg === "--json") options.jsonPath = value;
      if (arg === "--html") options.htmlPath = value;
      if (arg === "--policy") options.policyPath = value;
      if (arg === "--soffice") options.sofficePath = value;
      if (arg === "--timeout") options.timeoutMs = Number(value);
    } else throw new Error(`Unknown option ${arg}`);
  }
  return { positional, options };
}

async function writeOutput(filePath, contents) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.writeFile(filePath, contents);
}

export async function runCli(argv) {
  const { positional, options } = parseArgs(argv);
  if (options.help || argv.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  const [command, filePath, ...extra] = positional;
  if (command !== "test" || !filePath || extra.length) throw new Error(`Expected 'sheetparity test <file.xlsx>'\n\n${HELP}`);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("--timeout must be a positive number of milliseconds");
  const policy = options.policyPath ? JSON.parse(await fs.readFile(options.policyPath, "utf8")) : {};
  const result = await testWorkbook(filePath, { matrix: options.matrix, timeoutMs: options.timeoutMs, sofficePath: options.sofficePath, policy });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.jsonPath === "-") process.stdout.write(json);
  else {
    process.stdout.write(renderHuman(result));
    if (options.jsonPath) await writeOutput(options.jsonPath, json);
  }
  if (options.htmlPath) await writeOutput(options.htmlPath, renderHtml(result));
  process.exitCode = result.summary.status === "pass" ? 0 : result.summary.status === "incomplete" ? 3 : 1;
}
