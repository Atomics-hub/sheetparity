import fs from "node:fs/promises";
import path from "node:path";
import { testWorkbook } from "../src/runner.js";
import { sha256 } from "../src/result.js";

const root = path.resolve(import.meta.dirname, "..");
const manifestBytes = await fs.readFile(path.join(root, "fixtures", "manifest.json"));
const manifestSha256 = sha256(manifestBytes);
const requiredManifestSha256 = process.env.SHEETPARITY_PROTOCOL_MANIFEST_SHA256 || null;
if (requiredManifestSha256 && requiredManifestSha256 !== manifestSha256) {
  throw new Error(`Fixture manifest does not match the frozen protocol: expected ${requiredManifestSha256}, observed ${manifestSha256}`);
}
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const outputDir = path.resolve(process.env.SHEETPARITY_FALSIFICATION_OUTPUT || path.join(root, "outputs", "falsification"));
const sofficePath = process.env.SHEETPARITY_SOFFICE || "soffice";
const matrix = process.env.SHEETPARITY_MATRIX || "libreoffice";
const repeatCount = Number(process.env.SHEETPARITY_REPEAT_COUNT || 20);
await fs.mkdir(path.join(outputDir, "results"), { recursive: true });

async function runFixture(entry) {
  const started = Date.now();
  const result = await testWorkbook(path.join(root, "fixtures", entry.file), { matrix, sofficePath, timeoutMs: 120_000 });
  await fs.writeFile(path.join(outputDir, "results", `${entry.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const libreOffice = result.engines.find((engine) => engine.id === "libreoffice" && engine.status === "available");
  const googleSheets = result.engines.find((engine) => engine.id === "google-sheets" && engine.status === "available");
  const independentComparison = libreOffice && googleSheets
    ? result.engineComparisons.find((comparison) => [comparison.leftEngineId, comparison.rightEngineId].includes("libreoffice") && [comparison.leftEngineId, comparison.rightEngineId].includes("google-sheets"))
    : null;
  const libreOfficeComparison = result.comparisons.find((comparison) => comparison.engineId === "libreoffice");
  const sourceFailed = result.summary.sourceMaterialErrors > 0;
  const engineFailed = result.engines.some((engine) => engine.status === "error" || engine.open?.outcome === "rejected");
  const comparisonFailed = result.comparisons.some((comparison) => comparison.materialDifferenceCount > 0)
    || result.engineComparisons.some((comparison) => comparison.materialDifferenceCount > 0);
  return {
    id: entry.id,
    classification: entry.classification,
    expectedMaterialFailure: entry.expectedMaterialFailure,
    packageWellFormed: entry.packageWellFormed,
    semanticDivergence: entry.semanticDivergence,
    prospectiveRound: entry.prospectiveRound || null,
    publicSilentValueCandidate: entry.publicSilentValueCandidate === true,
    status: result.summary.status,
    detected: sourceFailed || engineFailed || comparisonFailed,
    sourceMaterialErrors: result.summary.sourceMaterialErrors,
    materialDifferenceCount: result.summary.materialDifferenceCount,
    libreOfficeMaterialDifferenceCount: libreOfficeComparison?.materialDifferenceCount || 0,
    independentMaterialDifferenceCount: independentComparison?.materialDifferenceCount || 0,
    independentDivergence: Boolean(independentComparison?.materialDifferenceCount),
    fingerprint: result.fingerprint,
    engines: Object.fromEntries(result.engines.map((engine) => [engine.id, {
      status: engine.status,
      version: engine.version,
      releaseChannel: engine.environment?.releaseChannel || null,
      outcome: engine.open?.outcome || null,
      locale: engine.environment?.locale || null,
      timezone: engine.environment?.timezone || null,
      endpoint: engine.environment?.endpoint || null,
      remoteRetention: engine.environment?.remoteRetention || null,
    }])),
    engineVersion: result.engines[0]?.version || null,
    engineReleaseChannel: result.engines[0]?.environment?.releaseChannel || null,
    engineOutcome: result.engines[0]?.open?.outcome || null,
    engineOutcomes: Object.fromEntries(result.engines.map((engine) => [engine.id, engine.open?.outcome || engine.status])),
    elapsedMs: Date.now() - started,
  };
}

const scoredEntries = manifest.fixtures.filter((entry) => entry.classification === "known-good" || entry.classification === "known-bad");
const experimentEntries = matrix.split(",").map((item) => item.trim()).includes("google-sheets") ? manifest.fixtures : scoredEntries;
const runs = [];
for (const [index, entry] of experimentEntries.entries()) {
  process.stderr.write(`[${index + 1}/${experimentEntries.length}] ${entry.id}\n`);
  runs.push(await runFixture(entry));
}

const repeatEntry = manifest.fixtures.find((entry) => entry.id === "good-01-basic-arithmetic");
const repeats = [];
for (let index = 0; index < repeatCount; index += 1) {
  process.stderr.write(`[repeat ${index + 1}/${repeatCount}] ${repeatEntry.id}\n`);
  repeats.push(await runFixture({ ...repeatEntry, id: `${repeatEntry.id}-repeat-${String(index + 1).padStart(2, "0")}` }));
}

const goodRuns = runs.filter((item) => item.classification === "known-good");
const badRuns = runs.filter((item) => item.classification === "known-bad");
const badDetected = badRuns.filter((item) => item.detected).length;
const goodFalsePositives = goodRuns.filter((item) => item.detected).length;
const modalFingerprint = Object.entries(repeats.reduce((counts, item) => ({ ...counts, [item.fingerprint]: (counts[item.fingerprint] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
const stableRepeatCount = modalFingerprint?.[1] || 0;
const semanticLocalDetected = badRuns.filter((item) => item.packageWellFormed && item.semanticDivergence && item.libreOfficeMaterialDifferenceCount > 0).length;
const independentDivergenceFixtures = runs.filter((item) => item.packageWellFormed && item.independentDivergence).length;
const publicSilentValueFixtures = runs.filter((item) => item.publicSilentValueCandidate && item.independentDivergence).length;
const engineVersions = [...new Set([...runs, ...repeats].map((item) => item.engineVersion).filter(Boolean))];
const releaseChannels = [...new Set([...runs, ...repeats].map((item) => item.engineReleaseChannel).filter(Boolean))];
const allExperimentRuns = [...runs, ...repeats];
const engineIds = [...new Set(allExperimentRuns.flatMap((item) => Object.keys(item.engines || {})))].sort();
const engineMatrix = Object.fromEntries(engineIds.map((engineId) => {
  const observations = allExperimentRuns.map((item) => item.engines?.[engineId]).filter(Boolean);
  return [engineId, {
    versions: [...new Set(observations.map((item) => item.version).filter(Boolean))],
    releaseChannels: [...new Set(observations.map((item) => item.releaseChannel).filter(Boolean))],
    locales: [...new Set(observations.map((item) => item.locale).filter(Boolean))],
    timezones: [...new Set(observations.map((item) => item.timezone).filter(Boolean))],
    endpoints: [...new Set(observations.map((item) => item.endpoint).filter(Boolean))],
    availableRuns: observations.filter((item) => item.status === "available").length,
    errorRuns: observations.filter((item) => item.status === "error").length,
    unavailableRuns: observations.filter((item) => item.status === "unavailable").length,
    cleanupFailures: observations.filter((item) => item.remoteRetention === "cleanup_failed").length,
  }];
}));

const thresholds = {
  knownBadDetected: { required: 16, observed: badDetected, pass: badDetected >= 16 },
  knownGoodFalsePositiveRate: { required: "<10%", observed: goodFalsePositives / goodRuns.length, pass: goodFalsePositives / goodRuns.length < 0.10 },
  repeatedRunStability: { required: `>=${Math.min(19, repeatCount)}/${repeatCount}`, observed: `${stableRepeatCount}/${repeatCount}`, pass: stableRepeatCount >= Math.min(19, repeatCount) },
  packageValidLocalSemanticDivergences: { required: 5, observed: semanticLocalDetected, pass: semanticLocalDetected >= 5, scope: "source cached value versus one real LibreOffice recalculation" },
  independentRealEngineDivergences: { required: 5, observed: independentDivergenceFixtures, pass: independentDivergenceFixtures >= 5, scope: "fixture-level material disagreement between LibreOffice and Google Sheets" },
  publicSilentValueFixture: { required: 1, observed: publicSilentValueFixtures, pass: publicSilentValueFixtures >= 1, scope: "public report-derived bytes with an independently verified silent value difference" },
  remoteCleanupFailures: { required: 0, observed: Object.values(engineMatrix).reduce((sum, engine) => sum + engine.cleanupFailures, 0), pass: Object.values(engineMatrix).every((engine) => engine.cleanupFailures === 0) },
};
const localGatePass = thresholds.knownBadDetected.pass && thresholds.knownGoodFalsePositiveRate.pass && thresholds.repeatedRunStability.pass && thresholds.packageValidLocalSemanticDivergences.pass && thresholds.remoteCleanupFailures.pass && releaseChannels.length === 1 && releaseChannels[0] === "stable";
const dossierTechnicalGatePass = localGatePass && thresholds.independentRealEngineDivergences.pass && thresholds.publicSilentValueFixture.pass && thresholds.remoteCleanupFailures.pass;
const unmetDossierGates = [
  thresholds.independentRealEngineDivergences.pass
    ? null
    : `independent real-engine divergences ${thresholds.independentRealEngineDivergences.observed}/${thresholds.independentRealEngineDivergences.required}`,
  thresholds.publicSilentValueFixture.pass
    ? null
    : `public silent-value fixtures ${thresholds.publicSilentValueFixture.observed}/${thresholds.publicSilentValueFixture.required}`,
].filter(Boolean);
const scorecard = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  protocol: { manifestSha256, requiredManifestSha256, fixtureCount: manifest.fixtureCount },
  engine: { versions: engineVersions, releaseChannels, requested: matrix, staticAnalysis: "always-on", matrix: engineMatrix },
  population: { knownGood: goodRuns.length, knownBad: badRuns.length, exploratory: runs.filter((item) => item.classification === "exploratory").length, repeats: repeatCount },
  thresholds,
  localGatePass,
  dossierTechnicalGatePass,
  verdict: dossierTechnicalGatePass ? "pass" : localGatePass ? "narrowed-local-proof-only" : "fail",
  reason: dossierTechnicalGatePass
    ? "All technical falsification thresholds passed."
    : localGatePass
      ? `The local detector passed, but the dossier technical gate did not: ${unmetDossierGates.join("; ")}.`
      : "One or more measurable local falsification thresholds failed.",
  runs,
  repeats,
};
await fs.writeFile(path.join(outputDir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
