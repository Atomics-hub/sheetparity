#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "fixtures", "corpus", "good-01-basic-arithmetic.xlsx");
const outputPath = path.resolve(process.argv[2] || path.join(root, "work", "probes", "formula-battery.xlsx"));

const cases = [
  ["ceiling-negative", "CEILING(-2.5,2)"],
  ["floor-negative", "FLOOR(-2.5,2)"],
  ["mod-negative", "MOD(-3,2)"],
  ["quotient-negative", "QUOTIENT(-3,2)"],
  ["round-binary", "ROUND(2.675,2)"],
  ["round-negative-half", "ROUND(-2.5,0)"],
  ["mround-negative", "MROUND(-10,-3)"],
  ["power-negative-fraction", "POWER(-1,0.5)"],
  ["sum-literal-boolean", "SUM(TRUE,1)"],
  ["numeric-string-coercion", "\"1\"+1"],
  ["blank-string-comparison", "1=\"\""],
  ["emoji-length", "LEN(\"💩\")"],
  ["emoji-unicode", "UNICODE(\"💩\")"],
  ["emoji-mid", "MID(\"💩a\",2,1)"],
  ["emoji-left", "LEFT(\"💩a\",1)"],
  ["emoji-find", "FIND(\"a\",\"💩a\")"],
  ["nonbreaking-trim", "LEN(TRIM(\"a  b\"))"],
  ["text-number-format", "TEXT(1.2,\"0.00\")"],
  ["date-1900-leap", "DATE(1900,2,29)"],
  ["weekday-1900", "WEEKDAY(DATE(1900,3,1))"],
  ["days360-leap", "DAYS360(DATE(2024,2,29),DATE(2024,3,31),FALSE)"],
  ["datedif-leap", "DATEDIF(DATE(2020,2,29),DATE(2021,2,28),\"y\")"],
  ["yearfrac-basis-one", "YEARFRAC(DATE(2019,2,28),DATE(2020,2,29),1)"],
  ["networkdays-weekend-mask", "NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,10),\"0000011\")"],
  ["percentile-inclusive", "PERCENTILE.INC({1,2,3,4},0.25)"],
  ["rank-eq", "RANK.EQ(3,{1,3,3,4},0)"],
  ["xlookup", "XLOOKUP(2,{1,2,3},{10,20,30})"],
  ["let", "LET(x,2,x+3)"],
  ["lambda", "LAMBDA(x,x+1)(2)"],
  ["sequence", "SUM(SEQUENCE(2,2,1,1))"],
  ["filter-array", "SUM(FILTER({1,2,3},{1,0,1}))"],
  ["unique-array", "COUNTA(UNIQUE({1,1,2,2}))"],
  ["sort-array", "INDEX(SORT({3,1,2}),1,1)"],
  ["textsplit", "COUNTA(TEXTSPLIT(\"a,b,c\",\",\"))"],
  ["tocol", "SUM(TOCOL({1,2;3,4}))"],
  ["take", "SUM(TAKE({1,2,3},,2))"],
  ["drop", "SUM(DROP({1,2,3},,1))"],
  ["choosecols", "SUM(CHOOSECOLS({1,2,3},1,3))"],
  ["isoweeknum", "ISOWEEKNUM(DATE(2021,1,1))"],
  ["workday-intl", "WORKDAY.INTL(DATE(2024,1,5),1,\"0000011\")"],
  ["complex-imaginary", "IMABS(\"3+4i\")"],
  ["decimal-hex", "DEC2HEX(-1)"],
  ["bitshift-negative", "BITRSHIFT(-8,1)"],
  ["error-type-na", "ERROR.TYPE(NA())"],
];

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const archive = unzipSync(new Uint8Array(await fs.readFile(sourcePath)));
const sheetPath = "xl/worksheets/sheet1.xml";
const original = strFromU8(archive[sheetPath]);
const rows = cases.map(([id, formula], index) => {
  const row = index + 10;
  return `<x:row r="${row}"><x:c r="A${row}" t="str"><x:v>${xmlEscape(id)}</x:v></x:c><x:c r="B${row}" t="n"><x:f>${xmlEscape(formula)}</x:f><x:v>0</x:v></x:c></x:row>`;
}).join("");
if (!original.includes("</x:sheetData>")) throw new Error("Probe seed has no sheetData boundary");
archive[sheetPath] = strToU8(original.replace("</x:sheetData>", `${rows}</x:sheetData>`));

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, Buffer.from(zipSync(archive, { level: 9 })));
await fs.writeFile(`${outputPath}.cases.json`, `${JSON.stringify({ source: path.relative(root, sourcePath), output: outputPath, cases: cases.map(([id, formula], index) => ({ id, formula, cell: `B${index + 10}` })) }, null, 2)}\n`);
console.log(`formula_probe=${outputPath}`);
console.log(`formula_cases=${cases.length}`);
