import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function yamlFile(relativePath) {
  const text = await fs.readFile(path.join(root, relativePath), "utf8");
  const document = parseDocument(text);
  assert.deepEqual(document.errors, [], relativePath);
  return document.toJS();
}

test("GitHub Action metadata parses and preserves reports on a failing test", async () => {
  const action = await yamlFile("action.yml");
  assert.equal(action.runs.using, "composite");
  const testStep = action.runs.steps.find((step) => step.name === "Test workbook");
  assert.ok(testStep);
  assert.match(testStep.run, /status=\$\{PIPESTATUS\[0\]\}/);
  assert.match(testStep.run, /GITHUB_STEP_SUMMARY/);
  assert.match(testStep.run, /exit "\$status"/);
});

test("CI workflows parse and third-party actions are commit pinned", async () => {
  const workflow = await yamlFile(".github/workflows/ci.yml");
  assert.ok(workflow.jobs.test);
  assert.ok(workflow.jobs["engine-smoke"]);
  const uses = Object.values(workflow.jobs).flatMap((job) => job.steps || []).map((step) => step.uses).filter(Boolean);
  assert.ok(uses.length >= 2);
  for (const action of uses) assert.match(action, /@[0-9a-f]{40}$/);
  await yamlFile(".github/workflows/sheetparity-example.yml");
});

test("pinned engine installer and package boundaries remain explicit", async () => {
  const installer = await fs.readFile(path.join(root, "scripts", "install-libreoffice-linux.sh"), "utf8");
  assert.match(installer, /VERSION="26\.2\.4"/);
  assert.match(installer, /SHA256="[0-9a-f]{64}"/);
  assert.match(installer, /sha256sum --check/);
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("docs"));
  assert.ok(packageJson.files.includes("scripts/google-oauth-authorize.mjs"));
  const ignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  for (const pattern of ["*.credentials.json", "client_secret*.json", "*.google.env"]) assert.match(ignore, new RegExp(pattern.replaceAll("*", ".*")));
});
