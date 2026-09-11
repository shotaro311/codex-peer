import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { applyInstall, parseArgs, planInstall, renderServiceFiles } from "../scripts/install-gemini-peer.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true }); });

function setup(platform = process.platform === "win32" ? "win32" : "darwin") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "install-gemini-"));
  roots.push(root);
  const workspace = path.join(root, "work space");
  fs.mkdirSync(workspace);
  const agy = path.join(root, platform === "win32" ? "agy.exe" : "agy");
  const server = path.join(root, "gemini-peer-server.mjs");
  const node = path.join(root, platform === "win32" ? "node.exe" : "node");
  fs.writeFileSync(node, "fixture");
  fs.writeFileSync(agy, "fixture");
  fs.writeFileSync(server, "fixture");
  const options = { defaultCwd: workspace, allowedRoots: [workspace], agyBin: agy, nodeBin: node, serverScript: server };
  const context = { platform, home: root, env: { HOME: root } };
  return { root, workspace, options, context };
}

test("dry-run has concrete changes but creates no private state or token", () => {
  const f = setup("darwin");
  const plan = planInstall(f.options, f.context);
  assert.equal(plan.changes.length, 4);
  assert.equal(plan.changes.find(change => change.path === plan.tokenPath).action, "create-private-random-token");
  assert.ok(plan.changes.some(change => change.content?.includes("<key>ProgramArguments</key>")));
  assert.equal(fs.existsSync(plan.stateDir), false);
  assert.equal(fs.existsSync(plan.peersPath), false);
});

test("apply merges only gemini, preserves existing fields and private token, and is idempotent", () => {
  const f = setup();
  const peersPath = path.join(f.root, ".codex-peer", "peers.json");
  fs.mkdirSync(path.dirname(peersPath));
  const original = { defaults: { recordTranscripts: false }, completion: { enabled: true }, peers: { windows: { url: "wss://example.invalid" } } };
  const raw = JSON.stringify(original);
  fs.writeFileSync(peersPath, raw);
  const plan = planInstall(f.options, f.context);
  const first = applyInstall(plan);
  const token = fs.readFileSync(plan.tokenPath, "utf8");
  assert.equal(token.trim().length, 43);
  if (process.platform === "win32") {
    const quoted = plan.tokenPath.replaceAll("'", "''");
    const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[System.IO.File]::GetAccessControl('${quoted}'); $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl'){exit 1}`], { windowsHide: true });
    assert.equal(check.status, 0, "private token must grant access only to the current user");
  } else assert.equal(fs.statSync(plan.tokenPath).mode & 0o077, 0);
  assert.equal(fs.readFileSync(first.backupPath, "utf8"), raw);
  const merged = JSON.parse(fs.readFileSync(peersPath, "utf8"));
  assert.deepEqual(merged.defaults, original.defaults);
  assert.deepEqual(merged.completion, original.completion);
  assert.deepEqual(merged.peers.windows, original.peers.windows);
  assert.equal(merged.peers.gemini.url, "ws://127.0.0.1:17848");
  assert.ok(!JSON.stringify(first).includes(token.trim()));
  const secondPlan = planInstall(f.options, f.context);
  const second = applyInstall(secondPlan);
  assert.deepEqual(second.created, []);
  assert.equal(second.backupPath, null);
  assert.equal(fs.readFileSync(plan.tokenPath, "utf8"), token);
  merged.peers.gemini.label = "My Gemini";
  fs.writeFileSync(peersPath, JSON.stringify(merged));
  applyInstall(planInstall(f.options, f.context));
  assert.equal(JSON.parse(fs.readFileSync(peersPath, "utf8")).peers.gemini.label, "My Gemini");
});

test("refuses changed configuration, occupied gemini entry and stale plan without overwriting", () => {
  const f = setup();
  const plan = planInstall(f.options, f.context);
  applyInstall(plan);
  assert.throws(() => planInstall({ ...f.options, model: "gemini-3.8-flash-high" }, f.context), /Existing Gemini config differs/);
  const current = fs.readFileSync(plan.configPath, "utf8");
  assert.equal(JSON.parse(current).model, "gemini-3.8-flash-medium");
  const newPlan = planInstall(f.options, f.context);
  fs.writeFileSync(plan.peersPath, JSON.stringify({ peers: { gemini: { url: "ws://127.0.0.1:9999" } } }));
  assert.throws(() => applyInstall(newPlan), /changed since planning/);
  assert.throws(() => planInstall(f.options, f.context), /Existing gemini peer differs/);
});

test("does not activate unless explicitly requested, and never restarts an existing LaunchAgent", { skip: process.platform === "win32" ? "requires POSIX directory permissions" : false }, () => {
  const f = setup();
  const plan = planInstall(f.options, f.context);
  const invocations = [];
  const runner = (...args) => { invocations.push(args); return { status: 0 }; };
  applyInstall(plan, { spawnSync: runner });
  assert.equal(invocations.length, 0);
  const second = applyInstall(planInstall(f.options, f.context), { activate: true, uid: 501, spawnSync: runner });
  assert.equal(second.activation, "already-registered-no-restart");
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0][1], ["print", "gui/501/com.codex-peer.gemini"]);
  assert.equal(invocations[0][2].shell, false);
});

test("Mac activation bootstraps only the generated Gemini LaunchAgent", { skip: process.platform === "win32" ? "requires POSIX directory permissions" : false }, () => {
  const f = setup();
  const plan = planInstall(f.options, f.context);
  const calls = [];
  const result = applyInstall(plan, { activate: true, uid: 501, spawnSync: (bin, args, options) => {
    calls.push({ bin, args, options });
    return { status: args[0] === "print" ? 113 : 0 };
  } });
  assert.equal(result.activation, "registered-and-started");
  assert.deepEqual(calls[1].args, ["bootstrap", "gui/501", plan.services[0].filename]);
  assert.equal(calls[1].options.windowsHide, true);
});

test("Windows registration uses hidden native launcher, current user, no force replacement or login", () => {
  const files = renderServiceFiles({ platform: "win32", home: "C:\\Users\\O'Brien", stateDir: "C:\\Users\\O'Brien\\.gemini-peer",
    nodeBin: "C:\\Program Files\\nodejs\\node.exe", serverScript: "C:\\peer\\dist\\gemini-peer-server.mjs", configPath: "C:\\Users\\O'Brien\\.gemini-peer\\config.json" });
  assert.equal(files.length, 2);
  const vbs = files.find(file => file.filename.endsWith(".vbs")).content;
  const ps = files.find(file => file.filename.endsWith(".ps1")).content;
  assert.match(vbs, /runner\.Run\(command, 0, True\)/);
  assert.match(vbs, /node\.exe/);
  assert.match(ps, /O''Brien/);
  assert.match(ps, /-AtLogOn -User \$account/);
  assert.match(ps, /-LogonType Interactive -RunLevel Limited/);
  assert.match(ps, /Register-ScheduledTask/);
  assert.ok(!ps.includes("-Force"));
  assert.ok(!ps.includes("agy -p"));
  assert.throws(() => renderServiceFiles({ platform: "win32", home: "C:\\user", stateDir: "C:\\user", nodeBin: 'bad"path', serverScript: "x", configPath: "x" }), /quotes/);
});

test("requires explicit activation and valid roots/executables", () => {
  assert.throws(() => parseArgs(["--activate", "--default-cwd", "/tmp"]), /requires --apply/);
  assert.throws(() => parseArgs(["--apply", "--dry-run", "--default-cwd", "/tmp"]), /not both/);
  assert.deepEqual(parseArgs(["--default-cwd", "/tmp", "--allowed-root", "/tmp", "--dry-run"]).allowedRoots, ["/tmp"]);
  const f = setup();
  assert.throws(() => planInstall({ ...f.options, agyBin: path.join(f.root, "missing") }, f.context), /missing/);
  assert.throws(() => planInstall({ ...f.options, allowedRoots: [path.dirname(f.root)] }, { ...f.context, platform: "linux" }), /Only macOS/);
});


test("Windows activation scopes policy and modules to the child and runs only generated registration", { skip: process.platform !== "win32" ? "requires Windows service paths" : false }, () => {
  const f = setup("win32");
  const calls = [];
  const result = applyInstall(planInstall(f.options, f.context), { activate: true, spawnSync: (bin, args, options) => {
    calls.push({ bin, args, options });
    return { status: 0 };
  } });
  assert.equal(result.activation, "registration-command-completed-check-peer-health");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bin, "powershell.exe");
  assert.match(calls[0].args.at(-1), /Directory\]::SetAccessControl/);
  assert.deepEqual(calls[1].args.slice(0, 5), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
  assert.equal(calls[1].args.at(-1), path.join(f.root, ".gemini-peer", "register-gemini-peer-task.ps1"));
  assert.match(calls[1].options.env.PSModulePath, /WindowsPowerShell\\v1\.0\\Modules$/);
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.windowsHide, true);
});
