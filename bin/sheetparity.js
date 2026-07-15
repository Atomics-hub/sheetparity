#!/usr/bin/env node

import { runCli } from "../src/cli.js";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(`sheetparity: ${error.message}`);
  if (process.env.SHEETPARITY_DEBUG === "1" && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 2;
});
