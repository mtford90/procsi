import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import {
  ensureProcsiDir,
  getProcsiPaths,
  writeDaemonPid,
  writeProxyPort,
} from "../../src/shared/project.js";
import { collectDebugInfo } from "../../src/cli/commands/debug-dump.js";
import { createLogger } from "../../src/shared/logger.js";

describe("debug-dump integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-debug-dump-test-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    storage = new RequestRepository(paths.databaseFile);

    cleanup = [];
  });

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("captures daemon status when daemon is running", async () => {
    const session = storage.registerSession("test", process.pid);

    const proxy = await createProxy({
      caKeyPath: paths.caKeyFile,
      caCertPath: paths.caCertFile,
      storage,
      sessionId: session.id,
    });
    cleanup.push(proxy.stop);

    const controlServer = createControlServer({
      socketPath: paths.controlSocketFile,
      storage,
      proxyPort: proxy.port,
    });
    cleanup.push(controlServer.close);

    // Write daemon files to simulate running daemon
    writeDaemonPid(tempDir, process.pid);
    writeProxyPort(tempDir, proxy.port);

    const dump = collectDebugInfo(tempDir);

    expect(dump.daemon.running).toBe(true);
    expect(dump.daemon.pid).toBe(process.pid);
    expect(dump.daemon.proxyPort).toBe(proxy.port);
  });

  it("captures daemon status when daemon is not running", () => {
    // Don't start any daemon components
    const dump = collectDebugInfo(tempDir);

    expect(dump.daemon.running).toBe(false);
    expect(dump.daemon.pid).toBeUndefined();
    expect(dump.daemon.proxyPort).toBeUndefined();
  });

  it("includes actual log content from procsi.log", () => {
    // Create some log entries
    const logger = createLogger("daemon", tempDir, "trace");
    logger.info("Test message 1", { key: "value1" });
    logger.warn("Test message 2", { key: "value2" });
    logger.error("Test message 3", { key: "value3" });
    logger.close();

    const dump = collectDebugInfo(tempDir);

    expect(dump.recentLogs.length).toBeGreaterThan(0);

    // Verify log entries are valid JSON
    for (const line of dump.recentLogs) {
      const parsed = JSON.parse(line);
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBeDefined();
      expect(parsed.component).toBeDefined();
      expect(parsed.msg).toBeDefined();
    }

    // Check specific messages are included
    const allLogs = dump.recentLogs.join("\n");
    expect(allLogs).toContain("Test message 1");
    expect(allLogs).toContain("Test message 2");
    expect(allLogs).toContain("Test message 3");
  });

  it("lists all files in .procsi directory", () => {
    // Create some test files
    fs.writeFileSync(path.join(paths.procsiDir, "custom.file"), "test");

    const dump = collectDebugInfo(tempDir);

    expect(dump.procsiDir.exists).toBe(true);
    // Should include standard files created in setup
    expect(dump.procsiDir.files).toContain("ca.pem");
    expect(dump.procsiDir.files).toContain("ca-key.pem");
    expect(dump.procsiDir.files).toContain("requests.db");
    expect(dump.procsiDir.files).toContain("custom.file");
  });

  it("dump contains all expected fields", () => {
    const dump = collectDebugInfo(tempDir);

    // Check all top-level fields
    expect(dump.timestamp).toBeDefined();
    expect(dump.procsiVersion).toBeDefined();
    expect(dump.system).toBeDefined();
    expect(dump.daemon).toBeDefined();
    expect(dump.procsiDir).toBeDefined();
    expect(dump.recentLogs).toBeDefined();

    // Check nested fields
    expect(dump.system.platform).toBeDefined();
    expect(dump.system.release).toBeDefined();
    expect(dump.system.nodeVersion).toBeDefined();
    expect(typeof dump.daemon.running).toBe("boolean");
    expect(typeof dump.procsiDir.exists).toBe("boolean");
    expect(Array.isArray(dump.procsiDir.files)).toBe(true);
    expect(Array.isArray(dump.recentLogs)).toBe(true);
  });
});
