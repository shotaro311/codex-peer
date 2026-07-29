import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = fs.readFileSync(
  path.join(root, "scripts", "windows", "install-codex-peer-watchdog-task.ps1"),
  "utf8"
);
const launcher = fs.readFileSync(
  path.join(root, "scripts", "windows", "codex-peer-watchdog-hidden.vbs"),
  "utf8"
);

describe("Windows watchdog scheduling", () => {
  it("registers wscript instead of node as the scheduled task action", () => {
    assert.match(installer, /New-ScheduledTaskAction/);
    assert.match(installer, /wscript\.exe/i);
    assert.match(installer, /\/\/B \/\/Nologo/);
    assert.doesNotMatch(installer, /New-ScheduledTaskAction[\s\S]{0,200}-Execute \$nodeExecutable/);
  });

  it("launches the Node watchdog with a hidden window and waits for its exit code", () => {
    assert.match(launcher, /shell\.Run\(command,\s*0,\s*True\)/i);
    assert.match(launcher, /codex-peer-watchdog\.mjs/i);
    assert.match(launcher, /--config/i);
  });
});
