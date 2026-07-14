import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the bundled MCP server imports without node_modules", async () => {
  const source = path.resolve("dist/codex-peer-mcp.mjs");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-peer-bundle-"));
  const copy = path.join(tempDir, "codex-peer-mcp.mjs");

  try {
    fs.copyFileSync(source, copy);
    const module = await import(`${pathToFileURL(copy).href}?test=${Date.now()}`);
    assert.equal(typeof module.createMcpServer, "function");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("the bundled MCP server completes an stdio handshake", async () => {
  const client = new Client({ name: "codex-peer-smoke", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/codex-peer-mcp.mjs")],
    cwd: process.cwd(),
    stderr: "pipe"
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map(tool => tool.name),
      ["peer_health", "peer_message", "peer_wait", "peer_wait_until_complete", "peer_threads", "peer_read"]
    );
    assert.ok(result.tools.every(tool => tool.annotations?.openWorldHint === true));
  } finally {
    await client.close();
  }
});
