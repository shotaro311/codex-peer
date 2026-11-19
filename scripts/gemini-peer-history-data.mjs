import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_LINES = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_.:/-]{0,199}$/;

// This is the CLI's full conversation export, not its tool execution ledger.
export async function loadCliTranscript(conversationId, { home = os.homedir() } = {}) {
  if (typeof conversationId !== "string" || !UUID.test(conversationId)) {
    throw new TypeError("A UUID conversation ID is required");
  }
  const entries = [];
  const warnings = [];
  const filename = path.join(home, ".gemini", "antigravity-cli", "brain", conversationId,
    ".system_generated", "logs", "transcript_full.jsonl");
  let file;
  let raw;
  try {
    file = await fs.open(filename, "r");
    const stat = await file.stat();
    if (!stat.isFile()) return { entries, warnings: ["CLI transcript is not a regular file."] };
    if (stat.size > MAX_FILE_BYTES) return { entries, warnings: ["CLI transcript exceeds the 16 MiB limit."] };
    // Bound the read even if an active CLI appends after stat().
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES) return { entries, warnings: ["CLI transcript exceeds the 16 MiB limit."] };
    raw = buffer.subarray(0, length).toString("utf8");
  } catch (error) {
    warnings.push(error.code === "ENOENT" ? "CLI transcript is not available." : "CLI transcript could not be read.");
    return { entries, warnings };
  } finally {
    await file?.close().catch(() => {});
  }

  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_LINES) warnings.push("CLI transcript exceeds the 100000-line limit; later lines were omitted.");
  for (let index = 0; index < Math.min(lines.length, MAX_LINES); index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const warn = message => warnings.push(`CLI transcript line ${index + 1}: ${message}`);
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      warn("exceeds the 1 MiB line limit; omitted.");
      continue;
    }
    let row;
    try { row = JSON.parse(line); } catch { warn("invalid JSON; omitted."); continue; }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      warn("invalid record; omitted.");
      continue;
    }
    const role = row.type === "USER_INPUT" && row.source === "USER_EXPLICIT" ? "user"
      : row.type === "PLANNER_RESPONSE" && row.source === "MODEL" ? "assistant" : null;
    if (!role) continue;
    if (!Number.isSafeInteger(row.step_index) || row.step_index < 0 ||
        (row.content !== undefined && typeof row.content !== "string") ||
        (role === "user" && typeof row.content !== "string")) {
      warn("invalid message fields; omitted.");
      continue;
    }
    let createdAt = null;
    if (typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))) {
      createdAt = row.created_at;
    } else {
      warn("message timestamp is missing or invalid.");
    }
    const toolNames = [];
    if (role === "assistant" && row.tool_calls !== undefined) {
      if (!Array.isArray(row.tool_calls)) {
        warn("invalid tool names; omitted.");
      } else {
        let invalid = false;
        for (const call of row.tool_calls) {
          if (call && typeof call.name === "string" && TOOL_NAME.test(call.name)) {
            if (!toolNames.includes(call.name)) toolNames.push(call.name);
          } else invalid = true;
        }
        if (invalid) warn("invalid tool names; omitted.");
      }
    }
    const text = row.content ?? "";
    if (!text.trim() && toolNames.length === 0) continue;
    entries.push({ role, text, createdAt, stepIndex: row.step_index,
      ...(toolNames.length ? { toolNames } : {}) });
    if (Array.isArray(row.truncated_fields) && row.truncated_fields.includes("content")) {
      warn("message content was truncated by the CLI.");
    }
  }
  return { entries, warnings };
}
