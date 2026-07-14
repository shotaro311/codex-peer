#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
const mcpPath = path.join(root, ".mcp.json");
const skillPath = path.join(root, "skills", "codex-peer", "SKILL.md");
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const licensePath = path.join(root, "LICENSE");
const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");
const bundlePath = path.join(root, "dist", "codex-peer-mcp.mjs");
const bundleNormalizerPath = path.join(root, "scripts", "normalize-bundle.mjs");

for (const required of [manifestPath, mcpPath, skillPath, marketplacePath, licensePath, noticesPath, bundlePath, bundleNormalizerPath]) {
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
if (!Array.isArray(manifest.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length > 3) {
  throw new Error("plugin.json interface.defaultPrompt must contain at most 3 prompts.");
}

const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
if (!mcp.mcpServers?.codex_peer) {
  throw new Error(".mcp.json must define mcpServers.codex_peer.");
}
if (!Array.isArray(mcp.mcpServers.codex_peer.args) || mcp.mcpServers.codex_peer.args.length === 0) {
  throw new Error("mcpServers.codex_peer.args must be a non-empty array.");
}
if (!mcp.mcpServers.codex_peer.args.includes("dist/codex-peer-mcp.mjs")) {
  throw new Error("mcpServers.codex_peer must run the bundled dist/codex-peer-mcp.mjs file.");
}

const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
const marketplacePlugin = marketplace.plugins?.find(plugin => plugin.name === "codex-peer");
if (!marketplacePlugin) {
  throw new Error("marketplace.json must include codex-peer.");
}
if (marketplacePlugin.policy?.installation !== "AVAILABLE") {
  throw new Error("codex-peer marketplace installation policy must be AVAILABLE.");
}
if (marketplacePlugin.policy?.authentication !== "ON_INSTALL") {
  throw new Error("codex-peer marketplace authentication policy must be ON_INSTALL.");
}

console.log("plugin validation passed");
