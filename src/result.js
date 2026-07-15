import { createHash } from "node:crypto";

export const RESULT_SCHEMA_VERSION = "1.0.0";

export const DEFAULT_POLICY = Object.freeze({
  numericAbsoluteTolerance: 1e-9,
  numericRelativeTolerance: 1e-9,
  ignoreVolatileFormulaValues: true,
  ignoreExternalFormulaValues: true,
  structuralLossIsMaterial: true,
  formulaChangeIsMaterial: true,
  errorChangeIsMaterial: true,
});

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableDiagnostics(diagnostics = []) {
  return diagnostics.map((diagnostic) => {
    if (diagnostic?.code !== "xlsx_roundtrip_export_inspected") return diagnostic;
    const { sha256: _sha256, sizeBytes: _sizeBytes, ...stableDiagnostic } = diagnostic;
    return stableDiagnostic;
  });
}

export function stableResultProjection(result) {
  return {
    schemaVersion: result.schemaVersion,
    source: {
      sha256: result.source.sha256,
      package: result.source.package,
      workbook: result.source.workbook,
      diagnostics: result.source.diagnostics,
    },
    engines: result.engines.map((engine) => ({
      id: engine.id,
      kind: engine.kind,
      version: engine.version,
      status: engine.status,
      environment: engine.environment,
      open: {
        outcome: engine.open?.outcome,
        exitCode: engine.open?.exitCode,
        timedOut: engine.open?.timedOut,
      },
      proofLayers: engine.proofLayers,
      workbook: engine.workbook,
      diagnostics: stableDiagnostics(engine.diagnostics),
    })),
    comparisons: result.comparisons,
    engineComparisons: result.engineComparisons,
    policy: result.policy,
    summary: result.summary,
  };
}

export function attachFingerprint(result) {
  result.fingerprint = sha256(stableStringify(stableResultProjection(result)));
  return result;
}
