const STATUS = {
  pass: "PASS",
  fail: "FAIL",
  incomplete: "INCOMPLETE",
  available: "READY",
  unavailable: "UNAVAILABLE",
  error: "ERROR",
};

function value(value) {
  if (value === null) return "∅";
  if (value === undefined) return "—";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function pad(text, length) {
  return String(text).padEnd(length, " ");
}

export function renderHuman(result) {
  const lines = [];
  lines.push(`SheetParity ${STATUS[result.summary.status] || result.summary.status.toUpperCase()}`);
  lines.push(`${result.source.fileName}  sha256:${result.source.sha256.slice(0, 12)}  ${result.source.sizeBytes} bytes`);
  lines.push("");
  lines.push(`${pad("Engine", 20)} ${pad("Outcome", 12)} Evidence vs source`);
  for (const engine of result.engines) {
    const comparison = result.comparisons.find((item) => item.engineId === engine.id);
    const outcome = engine.status === "available" ? comparison?.status || "pass" : engine.status;
    const evidence = engine.status === "available"
      ? `${comparison?.materialDifferenceCount || 0} material / ${comparison?.differenceCount || 0} total differences`
      : engine.open?.messages?.[0] || "no evidence";
    lines.push(`${pad(`${engine.label}${engine.version ? ` ${engine.version.replace(/^LibreOffice(?:Dev)?\s*/i, "")}` : ""}`, 20)} ${pad(STATUS[outcome] || String(outcome).toUpperCase(), 12)} ${evidence}`);
  }

  if (result.engineComparisons?.length) {
    lines.push("");
    lines.push("Engine-to-engine parity");
    for (const comparison of result.engineComparisons) {
      const pair = `${comparison.leftEngineId} ↔ ${comparison.rightEngineId}`;
      lines.push(`  ${pad(pair, 36)} ${pad(STATUS[comparison.status] || comparison.status.toUpperCase(), 8)} ${comparison.materialDifferenceCount} material / ${comparison.differenceCount} total differences`);
    }
  }

  const sourceErrors = result.source.diagnostics.filter((item) => item.severity === "error");
  if (sourceErrors.length) {
    lines.push("");
    lines.push("Package findings");
    for (const item of sourceErrors.slice(0, 20)) lines.push(`  ${item.code}: ${item.message}`);
  }

  const material = result.comparisons.flatMap((comparison) => comparison.differences.filter((item) => item.material).map((item) => ({ ...item, engineId: comparison.engineId })));
  if (material.length) {
    lines.push("");
    lines.push("Material differences");
    for (const item of material.slice(0, 30)) {
      const location = item.location || item.name || item.objectType || "workbook";
      lines.push(`  ${location}  ${item.engineId}  ${item.reason}  ${value(item.before)} → ${value(item.after)}`);
    }
    if (material.length > 30) lines.push(`  … ${material.length - 30} more in JSON report`);
  }

  const engineMaterial = (result.engineComparisons || []).flatMap((comparison) => comparison.differences.filter((item) => item.material).map((item) => ({
    ...item,
    pair: `${comparison.leftEngineId} ↔ ${comparison.rightEngineId}`,
  })));
  if (engineMaterial.length) {
    lines.push("");
    lines.push("Cross-engine differences");
    for (const item of engineMaterial.slice(0, 30)) {
      const location = item.location || item.name || item.objectType || "workbook";
      lines.push(`  ${location}  ${item.pair}  ${item.reason}  ${value(item.before)} → ${value(item.after)}`);
    }
    if (engineMaterial.length > 30) lines.push(`  … ${engineMaterial.length - 30} more in JSON report`);
  }

  const unavailable = result.engines.filter((engine) => engine.status === "unavailable");
  if (unavailable.length) {
    lines.push("");
    lines.push("Unavailable proof layers");
    for (const engine of unavailable) lines.push(`  ${engine.label}: ${engine.open.messages[0]}`);
  }

  lines.push("");
  lines.push(`fingerprint ${result.fingerprint}`);
  return `${lines.join("\n")}\n`;
}
