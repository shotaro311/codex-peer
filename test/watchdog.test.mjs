import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countMatchingDescendants,
  evaluateWatchdog,
  normalizeWatchdogConfig,
  parseElapsedSeconds,
  runWatchdog
} from "../scripts/codex-peer-watchdog.mjs";

const config = {
  maxUptimeSeconds: 86400,
  maxHelperProcesses: 3,
  maxHelperAgeSeconds: 3600
};

describe("watchdog decisions", () => {
  it("keeps a healthy idle receiver running", () => {
    assert.deepEqual(
      evaluateWatchdog({
        listenerPid: 10,
        healthOk: true,
        uptimeSeconds: 100,
        establishedConnections: 0,
        helperProcesses: 0,
        staleHelperProcesses: 0
      }, config),
      { action: "none", reason: "healthy" }
    );
  });

  it("restarts a missing receiver", () => {
    assert.deepEqual(
      evaluateWatchdog({
        listenerPid: null,
        healthOk: false,
        uptimeSeconds: 0,
        establishedConnections: 0,
        helperProcesses: 0,
        staleHelperProcesses: 0
      }, config),
      { action: "restart", reason: "listener-missing" }
    );
  });

  it("defers recovery while a peer connection is active", () => {
    assert.deepEqual(
      evaluateWatchdog({
        listenerPid: 10,
        healthOk: true,
        uptimeSeconds: 90000,
        establishedConnections: 1,
        helperProcesses: 1,
        staleHelperProcesses: 0
      }, config),
      { action: "defer", reason: "uptime-with-helpers", detail: "active-connections" }
    );
  });

  it("restarts an idle receiver with accumulated helpers", () => {
    assert.deepEqual(
      evaluateWatchdog({
        listenerPid: 10,
        healthOk: true,
        uptimeSeconds: 100,
        establishedConnections: 0,
        helperProcesses: 3,
        staleHelperProcesses: 0
      }, config),
      { action: "restart", reason: "helper-threshold" }
    );
  });

  it("restarts an idle receiver with a stale helper", () => {
    assert.deepEqual(
      evaluateWatchdog({
        listenerPid: 10,
        healthOk: true,
        uptimeSeconds: 100,
        establishedConnections: 0,
        helperProcesses: 1,
        staleHelperProcesses: 1
      }, config),
      { action: "restart", reason: "stale-helper" }
    );
  });
});

describe("watchdog parsing", () => {
  it("parses macOS elapsed time formats", () => {
    assert.equal(parseElapsedSeconds("01:02"), 62);
    assert.equal(parseElapsedSeconds("03:04:05"), 11045);
    assert.equal(parseElapsedSeconds("2-03:04:05"), 183845);
  });

  it("counts matching helpers only below the receiver", () => {
    const processes = [
      { pid: 11, ppid: 10, command: "node repl", uptimeSeconds: 10 },
      { pid: 12, ppid: 11, command: "SkyComputerUseClient", uptimeSeconds: 10 },
      { pid: 20, ppid: 1, command: "SkyComputerUseClient", uptimeSeconds: 10 }
    ];
    assert.equal(countMatchingDescendants(processes, 10, ["SkyComputerUseClient"]), 1);
  });
});

describe("watchdog safety", () => {
  it("rejects a launchd adapter on Windows", () => {
    assert.throws(
      () => normalizeWatchdogConfig({
        listenPort: 17845,
        service: { kind: "launchd", label: "example" }
      }, "win32", { USERPROFILE: "C:\\Users\\user" }),
      /only supported on macOS/
    );
  });

  it("rejects non-loopback health endpoints", () => {
    assert.throws(
      () => normalizeWatchdogConfig({
        listenPort: 17845,
        healthUrl: "https://example.com/healthz",
        service: { kind: "launchd", label: "example" }
      }, "darwin", { HOME: "/Users/user" }),
      /loopback/
    );
  });

  it("supports check-only without restarting", async () => {
    const result = await runWatchdog({
      listenPort: 17845,
      maxUptimeSeconds: 10,
      stateFile: "/tmp/codex-peer-watchdog-test-state.json",
      lockFile: `/tmp/codex-peer-watchdog-test-${process.pid}.lock`,
      service: { kind: "launchd", label: "example" }
    }, {
      platform: "darwin",
      checkOnly: true,
      snapshot: {
        listenerPid: 10,
        listenerCommand: "codex app-server",
        healthOk: true,
        uptimeSeconds: 20,
        establishedConnections: 0,
        helperProcesses: 1,
        staleHelperProcesses: 0
      }
    });

    assert.equal(result.action, "check-only");
    assert.equal(result.reason, "uptime-with-helpers");
  });
});
