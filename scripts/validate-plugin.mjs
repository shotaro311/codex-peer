#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
const mcpPath = path.join(root, ".mcp.json");
const skillPath = path.join(root, "skills", "codex-peer", "SKILL.md");

for (const required of [manifestPath, mcpPath, skillPath]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Missing required file: ${required}`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.name !== "codex-peer") {
  throw new Error("plugin.json name must be codex-peer.");
}
if (manifest.skills !== "./skills/") {
  throw new Error("plugin.json skills must point to ./skills/.");
}
if (manifest.mcpServers !== "./.mcp.json") {
  throw new Error("plugin.json mcpServers must point to ./.mcp.json.");
}

const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
if (!mcp.mcpServers?.codex_peer) {
  throw new Error(".mcp.json must define mcpServers.codex_peer.");
}
if (!Array.isArray(mcp.mcpServers.codex_peer.args) || mcp.mcpServers.codex_peer.args.length === 0) {
  throw new Error("mcpServers.codex_peer.args must be a non-empty array.");
}

console.log("plugin validation passed");
