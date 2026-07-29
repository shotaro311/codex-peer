#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_UPTIME_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_HELPERS = 3;
const DEFAULT_MAX_HELPER_AGE_SECONDS = 60 * 60;
const DEFAULT_COOLDOWN_SECONDS = 10 * 60;
const DEFAULT_HEALTH_TIMEOUT_MS = 3000;
const DEFAULT_RESTART_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

export function normalizeWatchdogConfig(config, platform = process.platform, env = process.env) {
  if (!config || typeof config !== "object") {
    throw new Error("Watchdog config must be an object.");
  }
  const listenPort = Number(config.listenPort);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error("listenPort must be an integer between 1 and 65535.");
  }
  const service = config.service;
  if (!service || typeof service !== "object") {
    throw new Error("service configuration is required.");
  }
  if (service.kind === "launchd") {
    if (platform !== "darwin") {
      throw new Error("launchd recovery is only supported on macOS.");
    }
    if (typeof service.label !== "string" || !service.label) {
      throw new Error("launchd service.label is required.");
    }
  } else if (service.kind === "windows-command") {
    if (platform !== "win32") {
      throw new Error("windows-command recovery is only supported on Windows.");
    }
    if (!Array.isArray(service.startCommand) || service.startCommand.length === 0) {
      throw new Error("windows-command service.startCommand is required.");
    }
    if (!Array.isArray(service.expectedCommandFragments) || service.expectedCommandFragments.length < 2) {
      throw new Error("windows-command requires at least two expectedCommandFragments.");
    }
  } else {
    throw new Error(`Unsupported service kind: ${service.kind || "missing"}`);
  }

  const home = env.HOME || env.USERPROFILE || os.homedir();
  const healthUrl = new URL(config.healthUrl || `http://127.0.0.1:${listenPort}/healthz`);
  if (healthUrl.protocol !== "http:" || !isLoopbackHost(healthUrl.hostname)) {
    throw new Error("healthUrl must use loopback http://.");
  }
  if (Number(healthUrl.port || 80) !== listenPort) {
    throw new Error("healthUrl port must match listenPort.");
  }
  return {
    listenPort,
    healthUrl: healthUrl.toString(),
    maxUptimeSeconds: positiveNumber(config.maxUptimeSeconds, DEFAULT_MAX_UPTIME_SECONDS),
    maxHelperProcesses: positiveNumber(config.maxHelperProcesses, DEFAULT_MAX_HELPERS),
    maxHelperAgeSeconds: positiveNumber(config.maxHelperAgeSeconds, DEFAULT_MAX_HELPER_AGE_SECONDS),
    helperPatterns: Array.isArray(config.helperPatterns) && config.helperPatterns.length > 0
      ? config.helperPatterns.map(String)
      : ["SkyComputerUseClient"],
    cooldownSeconds: positiveNumber(config.cooldownSeconds, DEFAULT_COOLDOWN_SECONDS),
    healthTimeoutMs: positiveNumber(config.healthTimeoutMs, DEFAULT_HEALTH_TIMEOUT_MS),
    restartTimeoutMs: positiveNumber(config.restartTimeoutMs, DEFAULT_RESTART_TIMEOUT_MS),
    stateFile: resolveHomePath(config.stateFile || path.join(home, ".codex-peer", `watchdog-${listenPort}.json`), home),
    lockFile: resolveHomePath(config.lockFile || path.join(home, ".codex-peer", `watchdog-${listenPort}.lock`), home),
    service
  };
}

export function evaluateWatchdog(snapshot, config) {
  if (!snapshot.listenerPid) {
    return { action: "restart", reason: "listener-missing" };
  }

  let reason = null;
  if (!snapshot.healthOk) {
    reason = "health-failed";
  } else if (snapshot.staleHelperProcesses > 0) {
    reason = "stale-helper";
  } else if (snapshot.helperProcesses >= config.maxHelperProcesses) {
    reason = "helper-threshold";
  } else if (snapshot.uptimeSeconds >= config.maxUptimeSeconds && snapshot.helperProcesses > 0) {
    reason = "uptime-with-helpers";
  }

  if (!reason) {
    return { action: "none", reason: "healthy" };
  }
  if (snapshot.establishedConnections > 0) {
    return { action: "defer", reason, detail: "active-connections" };
  }
  return { action: "restart", reason };
}

export function parseElapsedSeconds(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const daySplit = text.split("-");
  const days = daySplit.length === 2 ? Number(daySplit[0]) : 0;
  const timeParts = daySplit.at(-1).split(":").map(Number);
  if (timeParts.some(part => !Number.isFinite(part))) return 0;
  const [hours, minutes, seconds] = timeParts.length === 3
    ? timeParts
    : [0, timeParts[0] || 0, timeParts[1] || 0];
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function countMatchingDescendants(processes, rootPid, patterns) {
  return matchingDescendantStats(processes, rootPid, patterns).count;
}

export function matchingDescendantStats(processes, rootPid, patterns, maxAgeSeconds = Infinity) {
  if (!rootPid) return { count: 0, stale: 0 };
  const children = new Map();
  for (const processInfo of processes) {
    const list = children.get(processInfo.ppid) || [];
    list.push(processInfo);
    children.set(processInfo.ppid, list);
  }
  const lowered = patterns.map(pattern => pattern.toLowerCase());
  let count = 0;
  let stale = 0;
  const queue = [rootPid];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const child of children.get(parent) || []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      queue.push(child.pid);
      const command = `${child.name || ""} ${child.command || ""}`.toLowerCase();
      if (lowered.some(pattern => command.includes(pattern))) {
        count += 1;
        if ((child.uptimeSeconds || 0) >= maxAgeSeconds) {
          stale += 1;
        }
      }
    }
  }
  return { count, stale };
}

export async function runWatchdog(configInput, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const config = normalizeWatchdogConfig(configInput, platform, env);
  const release = acquireLock(config.lockFile);
  if (!release) {
    return { ok: true, status: "busy", action: "none" };
  }

  try {
    const snapshot = options.snapshot || await collectSnapshot(config, { platform });
    const decision = evaluateWatchdog(snapshot, config);
    if (decision.action !== "restart") {
      return publicResult(snapshot, decision);
    }

    const state = readJson(config.stateFile);
    const lastRestartAt = Date.parse(state?.lastRestartAt || "");
    if (Number.isFinite(lastRestartAt) && Date.now() - lastRestartAt < config.cooldownSeconds * 1000) {
      return publicResult(snapshot, {
        action: "defer",
        reason: decision.reason,
        detail: "cooldown"
      });
    }
    if (options.checkOnly) {
      return publicResult(snapshot, { ...decision, action: "check-only" });
    }

    await recoverService(config, snapshot, { platform, spawnImpl: options.spawnImpl });
    const recovered = await waitForHealthy(config, options.collectSnapshot);
    writeJson(config.stateFile, {
      lastRestartAt: new Date().toISOString(),
      reason: decision.reason,
      recovered
    });
    return {
      ok: recovered,
      status: recovered ? "recovered" : "restart-unverified",
      action: "restart",
      reason: decision.reason,
      before: publicSnapshot(snapshot)
    };
  } finally {
    release();
  }
}

async function collectSnapshot(config, options = {}) {
  const platform = options.platform || process.platform;
  let snapshot;
  if (platform === "win32") {
    snapshot = collectWindowsSnapshot(config, false);
  } else if (platform === "darwin" || platform === "linux") {
    snapshot = collectPosixSnapshot(config, false);
  } else {
    throw new Error(`Unsupported watchdog platform: ${platform}`);
  }
  snapshot.healthOk = await checkHealth(config.healthUrl, config.healthTimeoutMs);
  return snapshot;
}

function collectPosixSnapshot(config, healthOk) {
  const listenerPid = firstNumber(run("lsof", ["-nP", `-iTCP:${config.listenPort}`, "-sTCP:LISTEN", "-t"]));
  if (!listenerPid) {
    return emptySnapshot(healthOk);
  }
  const connections = uniqueNumbers(run("lsof", [
    "-nP",
    `-iTCP:${config.listenPort}`,
    "-sTCP:ESTABLISHED",
    "-t"
  ])).filter(pid => pid !== listenerPid);
  const uptimeSeconds = parseElapsedSeconds(run("ps", ["-o", "etime=", "-p", String(listenerPid)]));
  const command = run("ps", ["-o", "command=", "-p", String(listenerPid)]).trim();
  const processes = parsePosixProcesses(run("ps", ["-axo", "pid=,ppid=,etime=,command="]));
  const helpers = matchingDescendantStats(
    processes,
    listenerPid,
    config.helperPatterns,
    config.maxHelperAgeSeconds
  );
  return {
    listenerPid,
    listenerCommand: command,
    healthOk,
    uptimeSeconds,
    establishedConnections: connections.length,
    helperProcesses: helpers.count,
    staleHelperProcesses: helpers.stale
  };
}

function collectWindowsSnapshot(config, healthOk) {
  const script = [
    `$port=${config.listenPort}`,
    "$listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1",
    "$connections=@(Get-NetTCPConnection -State Established -LocalPort $port -ErrorAction SilentlyContinue).Count",
    "$now=Get-Date",
    "$all=@(Get-CimInstance Win32_Process | ForEach-Object {[pscustomobject]@{ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;Name=$_.Name;CommandLine=$_.CommandLine;UptimeSeconds=if($_.CreationDate){[math]::Max(0,[int]($now-$_.CreationDate).TotalSeconds)}else{0}}})",
    "$process=if($listener){$all | Where-Object ProcessId -eq $listener.OwningProcess | Select-Object -First 1}else{$null}",
    "[pscustomobject]@{ListenerPid=if($listener){$listener.OwningProcess}else{$null};Connections=$connections;Process=$process;All=$all}|ConvertTo-Json -Depth 5 -Compress"
  ].join(";");
  const parsed = JSON.parse(run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]) || "{}");
  const listenerPid = Number(parsed.ListenerPid) || null;
  if (!listenerPid) {
    return emptySnapshot(healthOk);
  }
  const all = Array.isArray(parsed.All) ? parsed.All : parsed.All ? [parsed.All] : [];
  const processes = all.map(item => ({
    pid: Number(item.ProcessId),
    ppid: Number(item.ParentProcessId),
    name: item.Name || "",
    command: item.CommandLine || "",
    uptimeSeconds: Number(item.UptimeSeconds) || 0
  }));
  const helpers = matchingDescendantStats(
    processes,
    listenerPid,
    config.helperPatterns,
    config.maxHelperAgeSeconds
  );
  return {
    listenerPid,
    listenerCommand: parsed.Process?.CommandLine || "",
    healthOk,
    uptimeSeconds: Number(parsed.Process?.UptimeSeconds) || 0,
    establishedConnections: Number(parsed.Connections) || 0,
    helperProcesses: helpers.count,
    staleHelperProcesses: helpers.stale
  };
}

async function recoverService(config, snapshot, options = {}) {
  if (config.service.kind === "launchd") {
    const uid = process.getuid?.();
    if (!Number.isInteger(uid)) {
      throw new Error("Unable to resolve the macOS user ID for launchd recovery.");
    }
    run("launchctl", ["kickstart", "-k", `gui/${uid}/${config.service.label}`], { allowFailure: false });
    return;
  }

  const command = snapshot.listenerCommand || "";
  if (snapshot.listenerPid) {
    const missing = config.service.expectedCommandFragments.filter(fragment => !command.includes(fragment));
    if (missing.length > 0) {
      throw new Error("Refusing to stop a Windows listener whose command does not match the configured app-server.");
    }
    run("taskkill.exe", ["/PID", String(snapshot.listenerPid), "/T", "/F"], { allowFailure: false });
  }
  const [program, ...args] = config.service.startCommand;
  const spawnImpl = options.spawnImpl || spawn;
  const child = spawnImpl(program, args, {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref?.();
}

async function waitForHealthy(config, collectOverride) {
  const deadline = Date.now() + config.restartTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (collectOverride) {
      const snapshot = await collectOverride(config);
      if (snapshot.listenerPid && snapshot.healthOk) return true;
    } else if (await checkHealth(config.healthUrl, config.healthTimeoutMs)) {
      return true;
    }
  }
  return false;
}

async function checkHealth(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function parsePosixProcesses(output) {
  return String(output || "").split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match ? [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: "",
      uptimeSeconds: parseElapsedSeconds(match[3]),
      command: match[4]
    }] : [];
  });
}

function emptySnapshot(healthOk) {
  return {
    listenerPid: null,
    listenerCommand: "",
    healthOk,
    uptimeSeconds: 0,
    establishedConnections: 0,
    helperProcesses: 0,
    staleHelperProcesses: 0
  };
}

function publicResult(snapshot, decision) {
  return {
    ok: true,
    status: decision.action === "none" ? "healthy" : decision.action,
    action: decision.action,
    reason: decision.reason,
    detail: decision.detail || null,
    snapshot: publicSnapshot(snapshot)
  };
}

function publicSnapshot(snapshot) {
  return {
    listenerPid: snapshot.listenerPid,
    healthOk: snapshot.healthOk,
    uptimeSeconds: snapshot.uptimeSeconds,
    establishedConnections: snapshot.establishedConnections,
    helperProcesses: snapshot.helperProcesses,
    staleHelperProcesses: snapshot.staleHelperProcesses
  };
}

function acquireLock(lockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = fs.openSync(lockFile, "wx", 0o600);
    fs.writeSync(fd, `${process.pid}\n`);
  } catch (error) {
    if (error.code === "EEXIST") return null;
    throw error;
  }
  return () => {
    try {
      fs.closeSync(fd);
    } finally {
      fs.rmSync(lockFile, { force: true });
    }
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

function run(program, args, options = {}) {
  try {
    return execFileSync(program, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (options.allowFailure === false) throw error;
    return "";
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveHomePath(value, home) {
  const text = String(value);
  if (text === "~" || text.startsWith("~/") || text.startsWith("~\\")) {
    return path.resolve(path.join(home, text.slice(2)));
  }
  return path.resolve(text);
}

function firstNumber(value) {
  return uniqueNumbers(value)[0] || null;
}

function uniqueNumbers(value) {
  return [...new Set(
    String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(number => Number.isFinite(number) && number > 0)
  )];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCli(argv) {
  const result = { configPath: null, checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") {
      result.configPath = argv[++index];
    } else if (argv[index] === "--check-only") {
      result.checkOnly = true;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  if (!result.configPath) {
    throw new Error("Usage: codex-peer-watchdog --config <path> [--check-only]");
  }
  return result;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const configPath = path.resolve(args.configPath);
  if (process.platform !== "win32" && (fs.statSync(configPath).mode & 0o077) !== 0) {
    throw new Error("Watchdog config permissions are too broad. Use chmod 600.");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const result = await runWatchdog(config, { checkOnly: args.checkOnly });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + "\n");
    process.exitCode = 1;
  });
}
