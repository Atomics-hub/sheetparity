import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { inspectXlsx } from "../xlsx.js";

const versionCache = new Map();
const BASIC_LIBRARY_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd">
<library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink">
 <library:library library:name="Standard" xlink:href="$(USER)/basic/Standard/script.xlb/" xlink:type="simple" library:link="false"/>
</library:libraries>`;
const BASIC_MODULE_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">
 <library:element library:name="SheetParity"/>
</library:library>`;
const BASIC_RECALC_MODULE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="SheetParity" script:language="StarBasic" script:moduleType="normal"><![CDATA[
Sub Recalculate(inputUrl As String, outputUrl As String)
  On Error GoTo Failed
  Dim loadArgs(1) As New com.sun.star.beans.PropertyValue
  loadArgs(0).Name = "Hidden"
  loadArgs(0).Value = True
  loadArgs(1).Name = "ReadOnly"
  loadArgs(1).Value = False
  Dim doc As Object
  doc = StarDesktop.loadComponentFromURL(inputUrl, "_blank", 0, loadArgs())
  If IsNull(doc) Or IsEmpty(doc) Then Exit Sub
  doc.enableAutomaticCalculation(True)
  doc.calculateAll()
  Dim saveArgs(1) As New com.sun.star.beans.PropertyValue
  saveArgs(0).Name = "FilterName"
  saveArgs(0).Value = "Calc MS Excel 2007 XML"
  saveArgs(1).Name = "Overwrite"
  saveArgs(1).Value = True
  doc.storeAsURL(outputUrl, saveArgs())
  doc.close(True)
  Exit Sub
Failed:
  On Error Resume Next
  If Not IsNull(doc) And Not IsEmpty(doc) Then doc.close(True)
End Sub
]]></script:module>`;

function runProcess(command, args, { timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: null, signal: null, timedOut: false, stdout, stderr, error });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut: signal === "SIGKILL", stdout, stderr, error: null });
    });
  });
}

function cleanMessages(...chunks) {
  return chunks.flatMap((chunk) => String(chunk || "").split(/\r?\n/)).map((line) => line.trim()).filter(Boolean);
}

function releaseChannel(version) {
  if (!version) return "unknown";
  if (/alpha|beta|dev|nightly/i.test(version)) return "development";
  if (/\brc\b/i.test(version)) return "release-candidate";
  return "stable";
}

async function detectVersion(sofficePath, timeoutMs, env) {
  if (!versionCache.has(sofficePath)) {
    versionCache.set(sofficePath, runProcess(sofficePath, ["--headless", "--version"], { timeoutMs, env }).then((probe) => ({
      version: cleanMessages(probe.stdout, probe.stderr)[0] || null,
      probe,
    })));
  }
  return versionCache.get(sofficePath);
}

async function installRecalculationMacro(profileDir) {
  const standardDir = path.join(profileDir, "user", "basic", "Standard");
  const basicDir = path.dirname(standardDir);
  await fs.mkdir(standardDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(basicDir, "script.xlc"), BASIC_LIBRARY_INDEX),
    fs.writeFile(path.join(standardDir, "script.xlb"), BASIC_MODULE_INDEX),
    fs.writeFile(path.join(standardDir, "SheetParity.xba"), BASIC_RECALC_MODULE),
  ]);
}

export function libreOfficeAdapter({ sofficePath = process.env.SHEETPARITY_SOFFICE || "soffice", timeoutMs = 60_000 } = {}) {
  return {
    id: "libreoffice",
    label: "LibreOffice",
    kind: "local-engine",
    async run(filePath) {
      const started = Date.now();
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sheetparity-lo-"));
      const inputDir = path.join(tempRoot, "input");
      const outputDir = path.join(tempRoot, "output");
      const profileDir = path.join(tempRoot, "profile");
      await Promise.all([fs.mkdir(inputDir), fs.mkdir(outputDir), fs.mkdir(profileDir)]);
      const inputPath = path.join(inputDir, "workbook.xlsx");
      await fs.copyFile(filePath, inputPath);

      const env = {
        ...process.env,
        HOME: tempRoot,
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
      };
      const diagnostics = [];
      try {
        const { version, probe } = await detectVersion(sofficePath, Math.min(timeoutMs, 10_000), env);
        if (probe.error) {
          return {
            id: "libreoffice",
            label: "LibreOffice",
            kind: "local-engine",
            version: null,
            status: "unavailable",
            durationMs: Date.now() - started,
            environment: { executable: sofficePath, releaseChannel: "unknown", locale: "C", timezone: "UTC", fontPack: "host", calculationMode: null },
            open: { outcome: "unavailable", exitCode: null, timedOut: false, messages: [probe.error.message] },
            proofLayers: { openImport: "unavailable", formulas: "unavailable", cachedValues: "unavailable", recalculatedValues: "unavailable", namedObjects: "unavailable", renders: "unavailable" },
            workbook: { sheets: [], namedObjects: [] },
            diagnostics: [{ code: "engine_executable_unavailable", severity: "error", material: true, message: probe.error.message }],
          };
        }
        const channel = releaseChannel(version);
        if (channel !== "stable") {
          diagnostics.push({
            code: "non_stable_engine",
            severity: "warning",
            material: false,
            message: `${version || "Unknown LibreOffice build"} is ${channel}; results are feasibility evidence, not the production baseline`,
          });
        }

        const profileUrl = pathToFileURL(profileDir).href;
        const commonArgs = [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--norestore",
          "--nofirststartwizard",
          `-env:UserInstallation=${profileUrl}`,
        ];
        const initialization = await runProcess(sofficePath, [...commonArgs, "--terminate_after_init"], { timeoutMs: Math.min(timeoutMs, 30_000), env });
        await installRecalculationMacro(profileDir);
        const outputPath = path.join(outputDir, "recalculated.xlsx");
        const macroUrl = `macro:///Standard.SheetParity.Recalculate(${pathToFileURL(inputPath).href},${pathToFileURL(outputPath).href})`;
        const execution = initialization.exitCode === 0 && !initialization.timedOut
          ? await runProcess(sofficePath, [...commonArgs, macroUrl], { timeoutMs, env })
          : initialization;
        let outputExists = false;
        try {
          const stat = await fs.stat(outputPath);
          outputExists = stat.isFile() && stat.size > 0;
        } catch {
          outputExists = false;
        }

        if (execution.timedOut) {
          diagnostics.push({ code: "engine_timeout", severity: "error", material: true, message: `LibreOffice exceeded ${timeoutMs} ms` });
        }
        if (execution.exitCode !== 0) {
          diagnostics.push({ code: "engine_nonzero_exit", severity: "error", material: true, exitCode: execution.exitCode, message: `LibreOffice exited with code ${execution.exitCode}` });
        }
        if (!outputExists) {
          diagnostics.push({ code: "engine_no_output", severity: "error", material: true, message: "LibreOffice did not produce a round-tripped XLSX file" });
        }

        const snapshot = outputExists ? await inspectXlsx(outputPath) : { package: {}, workbook: { sheets: [], namedObjects: [] }, diagnostics: [] };
        diagnostics.push(...(snapshot.diagnostics || []).map((item) => ({ ...item, origin: "roundtrip" })));
        const accepted = execution.exitCode === 0 && !execution.timedOut && outputExists;
        return {
          id: "libreoffice",
          label: "LibreOffice",
          kind: "local-engine",
          version,
          status: accepted ? "available" : "error",
          durationMs: Date.now() - started,
          environment: {
            executable: sofficePath,
            releaseChannel: channel,
            locale: "C",
            timezone: "UTC",
            fontPack: "host",
            calculationMode: snapshot?.package?.features?.calculationMode || null,
          },
          open: {
            outcome: accepted ? "accepted" : "rejected",
            exitCode: execution.exitCode,
            timedOut: execution.timedOut,
            messages: cleanMessages(initialization.stdout, initialization.stderr, execution.stdout, execution.stderr),
          },
          proofLayers: {
            openImport: accepted ? "available" : "failed",
            formulas: outputExists ? "available" : "unavailable",
            cachedValues: outputExists ? "available" : "unavailable",
            recalculatedValues: outputExists ? "available_after_calculateAll" : "unavailable",
            namedObjects: outputExists ? "partial_package_inventory" : "unavailable",
            renders: "unavailable_not_requested",
          },
          package: snapshot.package,
          workbook: snapshot.workbook,
          diagnostics,
        };
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    },
  };
}
