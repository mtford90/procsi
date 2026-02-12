import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { collectDebugInfo } from "./debug-dump.js";
import {
  ensureProcsiDir,
  getProcsiPaths,
  writeDaemonPid,
  writeProxyPort,
} from "../../shared/project.js";

describe("collectDebugInfo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-debug-dump-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes procsi version", () => {
    const dump = collectDebugInfo(tempDir);
    expect(dump.procsiVersion).toBeDefined();
    expect(typeof dump.procsiVersion).toBe("string");
  });

  it("includes system platform and node version", () => {
    const dump = collectDebugInfo(tempDir);

    expect(dump.system.platform).toBe(os.platform());
    expect(dump.system.release).toBe(os.release());
    expect(dump.system.nodeVersion).toBe(process.version);
  });

  it("includes daemon running status", () => {
    const dump = collectDebugInfo(tempDir);
    expect(typeof dump.daemon.running).toBe("boolean");
  });

  it("includes daemon pid and port when running", () => {
    // Set up .procsi directory with daemon files
    ensureProcsiDir(tempDir);
    writeDaemonPid(tempDir, process.pid); // Use current process as fake daemon
    writeProxyPort(tempDir, 8080);

    const dump = collectDebugInfo(tempDir);

    expect(dump.daemon.running).toBe(true);
    expect(dump.daemon.pid).toBe(process.pid);
    expect(dump.daemon.proxyPort).toBe(8080);
  });

  it("lists files in .procsi directory", () => {
    ensureProcsiDir(tempDir);
    const paths = getProcsiPaths(tempDir);

    // Create some test files
    fs.writeFileSync(path.join(paths.procsiDir, "test1.txt"), "test");
    fs.writeFileSync(path.join(paths.procsiDir, "test2.txt"), "test");

    const dump = collectDebugInfo(tempDir);

    expect(dump.procsiDir.exists).toBe(true);
    expect(dump.procsiDir.files).toContain("test1.txt");
    expect(dump.procsiDir.files).toContain("test2.txt");
  });

  it("includes recent log lines", () => {
    ensureProcsiDir(tempDir);
    const paths = getProcsiPaths(tempDir);

    // Create a log file with some entries
    const logEntries = [
      '{"ts":"2024-01-15T10:30:00.000Z","level":"info","component":"daemon","msg":"Test 1"}',
      '{"ts":"2024-01-15T10:30:01.000Z","level":"info","component":"daemon","msg":"Test 2"}',
      '{"ts":"2024-01-15T10:30:02.000Z","level":"info","component":"daemon","msg":"Test 3"}',
    ];
    fs.writeFileSync(paths.logFile, logEntries.join("\n") + "\n");

    const dump = collectDebugInfo(tempDir);

    expect(dump.recentLogs).toHaveLength(3);
    expect(dump.recentLogs[0]).toContain("Test 1");
    expect(dump.recentLogs[2]).toContain("Test 3");
  });

  it("handles missing log file gracefully", () => {
    ensureProcsiDir(tempDir);

    // Don't create a log file
    const dump = collectDebugInfo(tempDir);

    expect(dump.recentLogs).toEqual([]);
  });

  it("handles missing .procsi directory gracefully", () => {
    // Don't create .procsi directory
    const dump = collectDebugInfo(tempDir);

    expect(dump.procsiDir.exists).toBe(false);
    expect(dump.procsiDir.files).toEqual([]);
  });

  it("handles undefined project root gracefully", () => {
    const dump = collectDebugInfo(undefined);

    expect(dump.procsiDir.exists).toBe(false);
    expect(dump.daemon.running).toBe(false);
    expect(dump.recentLogs).toEqual([]);
  });

  it("limits recent logs to 200 lines", () => {
    ensureProcsiDir(tempDir);
    const paths = getProcsiPaths(tempDir);

    // Create a log file with more than 200 entries
    const logEntries: string[] = [];
    for (let i = 0; i < 300; i++) {
      logEntries.push(
        `{"ts":"2024-01-15T10:30:00.000Z","level":"info","component":"daemon","msg":"Line ${i}"}`
      );
    }
    fs.writeFileSync(paths.logFile, logEntries.join("\n") + "\n");

    const dump = collectDebugInfo(tempDir);

    expect(dump.recentLogs).toHaveLength(200);
    // Should have the last 200 lines (100-299)
    expect(dump.recentLogs[0]).toContain("Line 100");
    expect(dump.recentLogs[199]).toContain("Line 299");
  });

  it("includes timestamp in ISO format", () => {
    const dump = collectDebugInfo(tempDir);

    expect(dump.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});
