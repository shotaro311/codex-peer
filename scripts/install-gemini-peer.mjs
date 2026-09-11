#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const LABEL = "com.codex-peer.gemini";
const TASK_NAME = "CodexGeminiPeer";
const MODELS = ["gemini-3.8-flash-medium", "gemini-3.8-flash-high"];
const hash = text => createHash("sha256").update(text).digest("hex");
const xml = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const ps = text => `'${String(text).replaceAll("'", "''")}'`;

export function parseArgs(args) {
  const result = { allowedRoots: [] };
  const fields = { "--default-cwd": "defaultCwd", "--allowed-root": "allowedRoots", "--agy-bin": "agyBin",
    "--node-bin": "nodeBin", "--server-script": "serverScript", "--state-dir": "stateDir", "--peers-config": "peersConfig", "--model": "model" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--dry-run", "--apply", "--activate"].includes(arg)) { result[arg.slice(2).replace("-", "_")] = true; continue; }
    if (!fields[arg] || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Unknown option or missing value: ${arg}`);
    const value = args[++index];
    if (arg === "--allowed-root") result.allowedRoots.push(value);
    else if (result[fields[arg]]) throw new Error(`Duplicate option: ${arg}`);
    else result[fields[arg]] = value;
  }
  if (result.apply && result.dry_run) throw new Error("Choose --dry-run or --apply, not both.");
  if (result.activate && !result.apply) throw new Error("--activate requires --apply.");
  if (!result.defaultCwd) throw new Error("--default-cwd is required.");
  return result;
}

export function renderServiceFiles({ platform, home, stateDir, nodeBin, serverScript, configPath, windir = "C:\\Windows" }) {
  const paths = platform === "win32" ? path.win32 : path;
  for (const value of [home, stateDir, nodeBin, serverScript, configPath, windir]) {
    if (/[\r\n\0"]/u.test(value)) throw new Error("Service paths cannot contain quotes, newlines or NUL bytes.");
  }
  if (platform === "darwin") {
    const filename = paths.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
    const strings = [nodeBin, serverScript, configPath].map(value => `      <string>${xml(value)}</string>`).join("\n");
    return [{ filename, content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${strings}
    </array>
    <key>WorkingDirectory</key><string>${xml(stateDir)}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
    <key>ThrottleInterval</key><integer>60</integer>
    <key>StandardOutPath</key><string>${xml(paths.join(stateDir, "service.stdout.log"))}</string>
    <key>StandardErrorPath</key><string>${xml(paths.join(stateDir, "service.stderr.log"))}</string>
    <key>Umask</key><integer>63</integer>
  </dict>
</plist>
` }];
  }
  if (platform !== "win32") throw new Error("Gemini Peer service installation supports macOS and Windows.");
  const launcher = paths.join(stateDir, "gemini-peer-hidden.vbs");
  const registration = paths.join(stateDir, "register-gemini-peer-task.ps1");
  const executable = paths.join(windir, "System32", "wscript.exe");
  const argumentsText = `//B //Nologo "${launcher}"`;
  const quoteVbs = value => `"${value.replaceAll('"', '""')}"`;
  const command = [nodeBin, serverScript, configPath].map(value => `"${value}"`).join(" ");
  return [
    { filename: launcher, content: `Option Explicit\nDim runner, command, status\nSet runner = CreateObject("WScript.Shell")\ncommand = ${quoteVbs(command)}\nstatus = runner.Run(command, 0, True)\nWScript.Quit status\n` },
    { filename: registration, content: `$ErrorActionPreference = 'Stop'
$taskName = ${ps(TASK_NAME)}
$executable = ${ps(executable)}
$arguments = ${ps(argumentsText)}
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\\' -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Actions.Count -ne 1 -or $existing.Actions[0].Execute -ne $executable -or $existing.Actions[0].Arguments -ne $arguments) {
    throw 'An existing Gemini task has a different command; it was not changed.'
  }
  Write-Output 'Gemini task already registered; no restart requested.'
  exit 0
}
$action = New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory ${ps(stateDir)}
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Official Antigravity CLI receiver for Codex Gemini Peer.'
Register-ScheduledTask -TaskName $taskName -TaskPath '\\' -InputObject $task | Out-Null
Start-ScheduledTask -TaskName $taskName -TaskPath '\\'
Write-Output 'Gemini task registered and started.'
` }
  ];
}

function readExisting(filename) {
  if (!fs.existsSync(filename)) return null;
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error(`Expected a regular local configuration file: ${filename}`);
  return fs.readFileSync(filename, "utf8");
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(b).sort()) && keys.every(key => sameValue(a[key], b[key]));
  }
  return a === b;
}

export function planInstall(options, context = {}) {
  const platform = context.platform || process.platform;
  const env = context.env || process.env;
  if (!["darwin", "win32"].includes(platform)) throw new Error("Only macOS and Windows service installation is supported.");
  const home = path.resolve(context.home || env.HOME || env.USERPROFILE || os.homedir());
  const stateDir = path.resolve(options.stateDir || path.join(home, ".gemini-peer"));
  const cwd = fs.realpathSync(options.defaultCwd);
  const allowedRoots = [...new Set((options.allowedRoots?.length ? options.allowedRoots : [cwd]).map(root => fs.realpathSync(root)))];
  if (!fs.statSync(cwd).isDirectory() || allowedRoots.some(root => !fs.statSync(root).isDirectory())) throw new Error("Delegation roots and cwd must be existing directories.");
  if (!allowedRoots.some(root => { const relative = path.relative(root, cwd); return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); })) throw new Error("defaultCwd must be within an allowed root.");
  const model = options.model || MODELS[0];
  if (!MODELS.includes(model)) throw new Error("Only Gemini 3.8 Flash medium/high is supported.");
  const agyBin = path.resolve(options.agyBin || (platform === "darwin" ? path.join(home, ".local", "bin", "agy") : path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "agy", "bin", "agy.exe")));
  const nodeBin = path.resolve(options.nodeBin || process.execPath);
  const serverScript = path.resolve(options.serverScript || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "gemini-peer-server.mjs"));
  for (const binary of [agyBin, nodeBin, serverScript]) if (!fs.existsSync(binary) || !fs.statSync(binary).isFile()) throw new Error(`Required executable or bundled server is missing: ${binary}`);
  if (platform === "win32" && (!agyBin.toLowerCase().endsWith(".exe") || !nodeBin.toLowerCase().endsWith(".exe"))) throw new Error("Windows requires native agy.exe and node.exe paths.");
  const configPath = path.join(stateDir, "config.json");
  const tokenPath = path.join(stateDir, "peer-token");
  const peersPath = path.resolve(options.peersConfig || path.join(home, ".codex-peer", "peers.json"));
  const config = { stateDir, listen: { host: "127.0.0.1", port: 17848 }, authTokenFile: tokenPath, agyBin,
    defaultCwd: cwd, allowedRoots, model, executionMode: "read-only", timeoutMs: 1800000, maxConcurrentTurns: 2 };
  const oldConfig = readExisting(configPath);
  if (oldConfig && !sameValue(JSON.parse(oldConfig), config)) throw new Error(`Existing Gemini config differs from the requested setup; it was not changed: ${configPath}`);
  const oldToken = readExisting(tokenPath);
  if (oldToken !== null && (Buffer.byteLength(oldToken.trim()) < 24 || (platform === "darwin" && (fs.statSync(tokenPath).mode & 0o077)))) throw new Error("Existing peer token is invalid or not private; it was not changed.");
  const oldPeers = readExisting(peersPath);
  const peers = oldPeers ? JSON.parse(oldPeers) : { peers: {} };
  if (!peers || typeof peers !== "object" || Array.isArray(peers) || !peers.peers || typeof peers.peers !== "object" || Array.isArray(peers.peers)) throw new Error("Existing peers.json has an invalid peers map.");
  const peer = { url: "ws://127.0.0.1:17848", authTokenFile: tokenPath, defaultCwd: cwd };
  if (Object.hasOwn(peers.peers, "gemini") && !Object.entries(peer).every(([key, value]) => sameValue(peers.peers.gemini[key], value))) throw new Error("Existing gemini peer differs; no peer settings were changed.");
  const peerExists = Object.hasOwn(peers.peers, "gemini");
  const mergedPeers = { ...peers, peers: { ...peers.peers, gemini: peerExists ? peers.peers.gemini : peer } };
  const services = renderServiceFiles({ platform, home, stateDir, nodeBin, serverScript, configPath, windir: env.WINDIR });
  for (const service of services) {
    const old = readExisting(service.filename);
    if (old !== null && old !== service.content) throw new Error(`Existing Gemini service definition differs; it was not changed: ${service.filename}`);
    service.action = old === null ? "create" : "preserve";
  }
  if (fs.existsSync(stateDir) && (fs.lstatSync(stateDir).isSymbolicLink() || !fs.statSync(stateDir).isDirectory())) throw new Error("stateDir must be a regular directory, not a symlink.");
  return { platform, home, stateDir, configPath, tokenPath, peersPath, config, nodeBin, serverScript, services,
    oldConfig, oldToken: oldToken === null ? null : { hash: hash(oldToken) }, oldPeers, mergedPeers,
    changes: [
      { path: configPath, action: oldConfig === null ? "create" : "preserve", value: config },
      { path: tokenPath, action: oldToken === null ? "create-private-random-token" : "preserve-private-token" },
      { path: peersPath, action: peerExists ? "preserve" : "merge", add: peerExists ? {} : { gemini: peer } },
      ...services.map(({ filename, action, content }) => ({ path: filename, action, content }))
    ] };
}

function command(bin, args, runner = spawnSync) {
  // PowerShell 7 module paths are not compatible with the Windows PowerShell child.
  const env = bin === "powershell.exe" ? { ...process.env, PSModulePath: path.win32.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules") } : process.env;
  const result = runner(bin, args, { shell: false, windowsHide: true, encoding: "utf8", timeout: 30000, env });
  if (result.error || result.status !== 0) throw new Error("Gemini installation system command failed; inspect the local service or ACL configuration. No existing service was replaced.");
  return result;
}

export function applyInstall(plan, options = {}) {
  const runner = options.spawnSync || spawnSync;
  // Optimistic readback prevents replacing configuration changed after the dry-run plan.
  if (readExisting(plan.configPath) !== plan.oldConfig || readExisting(plan.peersPath) !== plan.oldPeers) throw new Error("Configuration changed since planning; run dry-run again.");
  const currentToken = readExisting(plan.tokenPath);
  if ((currentToken === null) !== (plan.oldToken === null) || (currentToken !== null && hash(currentToken) !== plan.oldToken.hash)) throw new Error("Peer token changed since planning; run dry-run again.");
  fs.mkdirSync(plan.stateDir, { recursive: true, mode: 0o700 });
  if (plan.platform === "darwin") {
    if ((fs.statSync(plan.stateDir).mode & 0o077) !== 0) throw new Error("Existing state directory is not private; inspect its permissions before installation.");
  } else {
    const script = `$ErrorActionPreference='Stop'; $p=${ps(plan.stateDir)}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl); foreach($f in @(${ps(plan.tokenPath)},${ps(plan.configPath)})){ if(Test-Path -LiteralPath $f){ foreach($a in (Get-Acl -LiteralPath $f).Access){ $id=$a.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($a.AccessControlType -eq 'Allow' -and $id -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){ throw 'Existing private file grants access to another account; inspect its ACL.' } } } }`;
    command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], runner);
  }
  const lock = path.join(plan.stateDir, "install.lock");
  const descriptor = fs.openSync(lock, "wx", 0o600);
  fs.closeSync(descriptor);
  const created = [];
  let backupPath = null;
  try {
    if (plan.oldToken === null) {
      fs.writeFileSync(plan.tokenPath, randomBytes(32).toString("base64url") + "\n", { flag: "wx", mode: 0o600 });
      created.push(plan.tokenPath);
    }
    if (plan.oldConfig === null) {
      fs.writeFileSync(plan.configPath, JSON.stringify(plan.config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      created.push(plan.configPath);
    }
    for (const service of plan.services) if (service.action === "create") {
      fs.mkdirSync(path.dirname(service.filename), { recursive: true });
      fs.writeFileSync(service.filename, service.content, { flag: "wx", mode: 0o600 });
      created.push(service.filename);
    }
    if (plan.changes.find(change => change.path === plan.peersPath).action === "merge") {
      if (readExisting(plan.peersPath) !== plan.oldPeers) throw new Error("peers.json changed during installation; no merge was written. Generated files were retained for review.");
      fs.mkdirSync(path.dirname(plan.peersPath), { recursive: true, mode: 0o700 });
      if (plan.oldPeers !== null) {
        backupPath = `${plan.peersPath}.before-gemini-${randomUUID()}.bak`;
        fs.writeFileSync(backupPath, plan.oldPeers, { flag: "wx", mode: 0o600 });
      }
      const temp = `${plan.peersPath}.${randomUUID()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(plan.mergedPeers, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      fs.renameSync(temp, plan.peersPath);
    }
    if (!sameValue(JSON.parse(fs.readFileSync(plan.configPath, "utf8")), plan.config) || !sameValue(JSON.parse(fs.readFileSync(plan.peersPath, "utf8")), plan.mergedPeers)) throw new Error("Installation readback did not match its planned configuration.");
    let activation = "not-requested";
    if (options.activate) {
      if (plan.platform === "darwin") {
        const uid = options.uid ?? process.getuid();
        const existing = runner("/bin/launchctl", ["print", `gui/${uid}/${LABEL}`], { shell: false, windowsHide: true, encoding: "utf8", timeout: 10000 });
        if (existing.status === 0) activation = "already-registered-no-restart";
        else { command("/bin/launchctl", ["bootstrap", `gui/${uid}`, plan.services[0].filename], runner); activation = "registered-and-started"; }
      } else {
        command("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", plan.services.find(service => service.filename.endsWith(".ps1")).filename], runner);
        activation = "registration-command-completed-check-peer-health";
      }
    }
    return { ok: true, created, peerConfig: plan.peersPath, backupPath, activation, verification: "Configuration readback matched. Authentication, model tasks and receiver health require separate checks." };
  } finally { fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = planInstall(options);
    const result = options.apply ? applyInstall(plan, { activate: options.activate }) : { dryRun: true, changes: plan.changes, activation: "Only --apply --activate registers and starts the Gemini service." };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error.code ? "Required local files or permissions were unavailable; no token values were logged." : error.message }) + "\n");
    process.exitCode = 1;
  }
}
