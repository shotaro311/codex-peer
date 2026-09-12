#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

for (const name of ["codex-peer-mcp.mjs", "gemini-peer-server.mjs"]) {
  const bundlePath = path.resolve("dist", name);
  const source = fs.readFileSync(bundlePath, "utf8");
  fs.writeFileSync(bundlePath, source.replace(/[ \t]+$/gm, ""), "utf8");
}
