#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const bundlePath = path.resolve("dist", "codex-peer-mcp.mjs");
const source = fs.readFileSync(bundlePath, "utf8");
fs.writeFileSync(bundlePath, source.replace(/[ \t]+$/gm, ""), "utf8");
