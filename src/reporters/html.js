function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function differenceRows(result) {
  const sourceRows = result.comparisons.flatMap((comparison) => comparison.differences.map((difference) => ({ comparison: `source → ${comparison.engineId}`, ...difference })));
  const engineRows = (result.engineComparisons || []).flatMap((comparison) => comparison.differences.map((difference) => ({ comparison: `${comparison.leftEngineId} ↔ ${comparison.rightEngineId}`, ...difference })));
  const rows = [...sourceRows, ...engineRows];
  if (!rows.length) return '<tr><td colspan="6" class="muted">No normalized differences.</td></tr>';
  return rows.map((row) => `<tr class="${row.material ? "material" : "ignored"}">
    <td>${escapeHtml(row.comparison)}</td><td>${escapeHtml(row.kind)}</td><td><code>${escapeHtml(row.location || row.name || row.objectType || "workbook")}</code></td>
    <td><code>${escapeHtml(JSON.stringify(row.before))}</code></td><td><code>${escapeHtml(JSON.stringify(row.after))}</code></td><td>${row.material ? "material" : escapeHtml(row.reason)}</td>
  </tr>`).join("\n");
}

export function renderHtml(result) {
  const engineCards = result.engines.map((engine) => {
    const comparison = result.comparisons.find((item) => item.engineId === engine.id);
    const status = engine.status === "available" ? comparison?.status || "pass" : engine.status;
    const detail = engine.status === "available"
      ? `${comparison?.materialDifferenceCount || 0} material / ${comparison?.differenceCount || 0} total differences`
      : engine.open?.messages?.[0] || "No engine evidence";
    return `<article class="card ${escapeHtml(status)}"><span class="eyebrow">${escapeHtml(engine.kind)}</span><h2>${escapeHtml(engine.label)}</h2><strong>${escapeHtml(status.toUpperCase())}</strong><p>${escapeHtml(engine.version || "version unavailable")}</p><p>${escapeHtml(detail)}</p></article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SheetParity · ${escapeHtml(result.source.fileName)}</title>
<style>
:root{color-scheme:light dark;--bg:#07130f;--panel:#10251d;--ink:#f3f7f4;--muted:#a9b9b0;--line:#315143;--pass:#70e1a1;--fail:#ff8c82;--warn:#f5cd67}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,#1d513c 0,transparent 35%),var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1180px;margin:auto;padding:56px 24px 80px}h1{font-size:clamp(38px,8vw,82px);line-height:.94;letter-spacing:-.055em;margin:8px 0 20px;max-width:950px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:11px;color:var(--muted)}.lede{font-size:19px;color:var(--muted);max-width:760px}.status{color:var(--pass)}.status.fail{color:var(--fail)}.status.incomplete{color:var(--warn)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:38px 0}.card{padding:22px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--panel) 92%,transparent);min-height:190px}.card h2{font-size:21px;margin:12px 0}.card strong{color:var(--pass)}.card.fail strong,.card.error strong{color:var(--fail)}.card.unavailable strong{color:var(--warn)}.card p{color:var(--muted);margin:8px 0;overflow-wrap:anywhere}.meta{display:flex;gap:24px;flex-wrap:wrap;color:var(--muted);margin:24px 0}section{margin-top:48px}table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:14px;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line)}th{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}tr.material td:last-child{color:var(--fail)}tr.ignored{color:var(--muted)}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}.muted{color:var(--muted)}footer{margin-top:54px;color:var(--muted);font-size:12px}@media(max-width:700px){.table-wrap{overflow:auto}table{min-width:780px}}
</style></head><body><main>
<span class="eyebrow">XLSX compatibility evidence</span>
<h1>SheetParity <span class="status ${escapeHtml(result.summary.status)}">${escapeHtml(result.summary.status.toUpperCase())}</span></h1>
<p class="lede">One workbook, named engines, normalized evidence. This report distinguishes package inspection, real-engine round trips, and proof layers that were unavailable.</p>
<div class="meta"><span>${escapeHtml(result.source.fileName)}</span><span>sha256 ${escapeHtml(result.source.sha256.slice(0,16))}</span><span>${result.source.sizeBytes} bytes</span><span>${escapeHtml(result.generatedAt)}</span></div>
<div class="grid">${engineCards}</div>
<section><span class="eyebrow">Normalized evidence</span><h2>Source and cross-engine differences</h2><div class="table-wrap"><table><thead><tr><th>Comparison</th><th>Kind</th><th>Location</th><th>Before</th><th>After</th><th>Materiality</th></tr></thead><tbody>${differenceRows(result)}</tbody></table></div></section>
<section><span class="eyebrow">Reproducibility</span><h2>Stable fingerprint</h2><p><code>${escapeHtml(result.fingerprint)}</code></p><p class="muted">Durations, temp paths, and timestamps are excluded from this fingerprint.</p></section>
<footer>SheetParity ${escapeHtml(result.schemaVersion)} · Engine claims are limited to the exact versions and proof layers shown above.</footer>
</main></body></html>`;
}
