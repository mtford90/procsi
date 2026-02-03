import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ensureHtpxDir, getHtpxPaths, writeDaemonPid } from "../../src/shared/project.js";
import { startDaemon, getDaemonVersion } from "../../src/shared/daemon.js";
import { getHtpxVersion } from "../../src/shared/version.js";

describe("version checking", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getHtpxPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-version-test-"));
    ensureHtpxDir(tempDir);
    paths = getHtpxPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Create storage
    storage = new RequestRepository(paths.databaseFile);

    cleanup = [];
  });

  afterEach(async () => {
    // Run cleanup in reverse order
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getDaemonVersion", () => {
    it("returns version from running daemon", async () => {
      const session = storage.registerSession("test", process.pid);
      const testVersion = "1.2.3";

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      // Write port file so isDaemonRunning thinks daemon is running
      fs.writeFileSync(paths.proxyPortFile, String(proxy.port));
      writeDaemonPid(tempDir, process.pid);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: testVersion,
      });
      cleanup.push(controlServer.close);

      const version = await getDaemonVersion(tempDir);
      expect(version).toBe(testVersion);
    });

    it("returns null when daemon is not running", async () => {
      const version = await getDaemonVersion(tempDir);
      expect(version).toBeNull();
    });
  });

  describe("startDaemon version checking", () => {
    it("calls onVersionMismatch when versions differ", async () => {
      const session = storage.registerSession("test", process.pid);
      const oldVersion = "0.0.1";

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      // Write port file so isDaemonRunning thinks daemon is running
      fs.writeFileSync(paths.proxyPortFile, String(proxy.port));
      writeDaemonPid(tempDir, process.pid);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: oldVersion,
      });
      cleanup.push(controlServer.close);

      const onVersionMismatch = vi.fn();
      const cliVersion = getHtpxVersion();

      // Since autoRestart is false, it should not restart
      await startDaemon(tempDir, {
        autoRestart: false,
        onVersionMismatch,
      });

      expect(onVersionMismatch).toHaveBeenCalledWith(oldVersion, cliVersion);
    });

    it("does not call onVersionMismatch when versions match", async () => {
      const session = storage.registerSession("test", process.pid);
      const cliVersion = getHtpxVersion();

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      // Write port file so isDaemonRunning thinks daemon is running
      fs.writeFileSync(paths.proxyPortFile, String(proxy.port));
      writeDaemonPid(tempDir, process.pid);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: cliVersion,
      });
      cleanup.push(controlServer.close);

      const onVersionMismatch = vi.fn();

      await startDaemon(tempDir, {
        autoRestart: false,
        onVersionMismatch,
      });

      expect(onVersionMismatch).not.toHaveBeenCalled();
    });
  });
});
