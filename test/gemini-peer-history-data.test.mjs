import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { loadCliTranscript } from "../scripts/gemini-peer-history-data.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(lines = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-history-test-"));
  roots.push(home);
  const id = randomUUID();
  const filename = path.join(home, ".gemini", "antigravity-cli", "brain", id, ".system_generated", "logs", "transcript_full.jsonl");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  return { home, id, filename };
}
function row(role, content, extra = {}) {
  return { type: role === "user" ? "USER_INPUT" : "PLANNER_RESPONSE", source: role === "user" ? "USER_EXPLICIT" : "MODEL",
    content, created_at: "2026-09-11T04:00:00Z", step_index: 0, ...extra };
}

test("extracts only user text, model text and tool names without changing the source", async () => {
  const f = fixture([
    row("user", "日本語 input", { thinking: "private", tool_calls: [{ name: "not_user_tool", args: "private" }] }),
    row("assistant", undefined, { step_index: 1, thinking: "private", tool_calls: [{ name: "read_file", args: "private" }, { name: "read_file" }] }),
    row("assistant", "Answer", { step_index: 3, tool_calls: [{ name: "mcp.test:run" }], extra: "private" }),
    row("assistant", "private", { type: "SYSTEM_MESSAGE" }),
    row("assistant", "private", { type: "GENERIC" }),
    row("user", "private", { source: "SYSTEM" }),
  ]);
  const before = fs.readFileSync(f.filename);
  const result = await loadCliTranscript(f.id, f);
  assert.deepEqual(result, { entries: [
    { role: "user", text: "日本語 input", createdAt: "2026-09-11T04:00:00Z", stepIndex: 0 },
    { role: "assistant", text: "", createdAt: "2026-09-11T04:00:00Z", stepIndex: 1, toolNames: ["read_file"] },
    { role: "assistant", text: "Answer", createdAt: "2026-09-11T04:00:00Z", stepIndex: 3, toolNames: ["mcp.test:run"] },
  ], warnings: [] });
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.deepEqual(fs.readFileSync(f.filename), before);
});

test("rejects unsafe identifiers and reports missing files without exposing paths", async () => {
  const f = fixture();
  for (const id of ["../secret", "", null, f.id + "/secret"]) {
    await assert.rejects(loadCliTranscript(id, f), /UUID conversation ID/);
  }
  const result = await loadCliTranscript(randomUUID(), f);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.warnings, ["CLI transcript is not available."]);
  assert.ok(!JSON.stringify(result).includes(f.home));
});

test("keeps valid messages around malformed lines and never returns rejected payloads", async () => {
  const f = fixture(["{private invalid", "null", "[]", row("user", { private: true }), row("user", "private", { step_index: -1 }),
    row("assistant", "Kept", { created_at: "private", tool_calls: [{ name: "bad name private", args: "private" }], truncated_fields: ["content"] }),
    row("assistant", "", { tool_calls: "private" }), row("assistant", "After", { step_index: 9 })]);
  const result = await loadCliTranscript(f.id, f);
  assert.deepEqual(result.entries.map(entry => entry.text), ["Kept", "After"]);
  assert.equal(result.entries[0].createdAt, null);
  assert.equal(result.entries[1].stepIndex, 9);
  assert.equal(result.warnings.length, 9);
  assert.ok(result.warnings.some(warning => warning.includes("truncated")));
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("ignores empty and thinking-only messages and preserves a final line without newline", async () => {
  const f = fixture([row("assistant", undefined, { thinking: "private" }), "", row("user", " "), row("assistant", "Final")]);
  fs.writeFileSync(f.filename, fs.readFileSync(f.filename, "utf8").trimEnd());
  const result = await loadCliTranscript(f.id, f);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].text, "Final");
  assert.deepEqual(result.warnings, []);
});

test("omits oversized lines and rejects oversized files", async () => {
  const f = fixture([row("user", "x".repeat(1024 * 1024)), row("assistant", "Retained")]);
  const result = await loadCliTranscript(f.id, f);
  assert.deepEqual(result.entries.map(entry => entry.text), ["Retained"]);
  assert.match(result.warnings[0], /1 MiB/);
  fs.truncateSync(f.filename, 16 * 1024 * 1024 + 1);
  const oversized = await loadCliTranscript(f.id, f);
  assert.deepEqual(oversized.entries, []);
  assert.match(oversized.warnings[0], /16 MiB/);
});

test("limits record count even for tiny records", async () => {
  const f = fixture();
  fs.writeFileSync(f.filename, "{}\n".repeat(100_000) + JSON.stringify(row("user", "Omitted")));
  const result = await loadCliTranscript(f.id, f);
  assert.deepEqual(result.entries, []);
  assert.match(result.warnings[0], /100000-line/);
});

test("reports a non-file source safely", async () => {
  const f = fixture();
  fs.renameSync(f.filename, f.filename + ".bak");
  fs.mkdirSync(f.filename);
  const result = await loadCliTranscript(f.id, f);
  assert.deepEqual(result.entries, []);
  assert.equal(result.warnings.length, 1);
  assert.ok(!JSON.stringify(result).includes(f.filename));
});
