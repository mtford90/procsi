import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findProjectRoot,
  getHtpxDir,
  ensureHtpxDir,
  getHtpxPaths,
  readProxyPort,
  writeProxyPort,
  readDaemonPid,
  writeDaemonPid,
  removeDaemonPid,
  isProcessRunning,
} from "../../src/shared/project.js";

describe("project utilities", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("findProjectRoot", () => {
    it("returns undefined when no .htpx or .git directory exists", () => {
      const result = findProjectRoot(tempDir);
      expect(result).toBeUndefined();
    });

    it("finds project root when .htpx directory exists", () => {
      const htpxDir = path.join(tempDir, ".htpx");
      fs.mkdirSync(htpxDir);

      const result = findProjectRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    it("finds project root when .git directory exists", () => {
      const gitDir = path.join(tempDir, ".git");
      fs.mkdirSync(gitDir);

      const result = findProjectRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    it("prefers .htpx over .git when both exist", () => {
      const htpxDir = path.join(tempDir, ".htpx");
      const gitDir = path.join(tempDir, ".git");
      fs.mkdirSync(htpxDir);
      fs.mkdirSync(gitDir);

      const result = findProjectRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    it("walks up directory tree to find project root", () => {
      const htpxDir = path.join(tempDir, ".htpx");
      const subDir = path.join(tempDir, "src", "components");
      fs.mkdirSync(htpxDir);
      fs.mkdirSync(subDir, { recursive: true });

      const result = findProjectRoot(subDir);
      expect(result).toBe(tempDir);
    });
  });

  describe("getHtpxDir", () => {
    it("returns path to .htpx directory", () => {
      const result = getHtpxDir(tempDir);
      expect(result).toBe(path.join(tempDir, ".htpx"));
    });
  });

  describe("ensureHtpxDir", () => {
    it("creates .htpx directory if it does not exist", () => {
      const htpxDir = ensureHtpxDir(tempDir);

      expect(htpxDir).toBe(path.join(tempDir, ".htpx"));
      expect(fs.existsSync(htpxDir)).toBe(true);
    });

    it("returns existing .htpx directory if it exists", () => {
      const existingDir = path.join(tempDir, ".htpx");
      fs.mkdirSync(existingDir);

      const htpxDir = ensureHtpxDir(tempDir);

      expect(htpxDir).toBe(existingDir);
      expect(fs.existsSync(htpxDir)).toBe(true);
    });
  });

  describe("getHtpxPaths", () => {
    it("returns all expected paths", () => {
      const paths = getHtpxPaths(tempDir);

      expect(paths.htpxDir).toBe(path.join(tempDir, ".htpx"));
      expect(paths.proxyPortFile).toBe(path.join(tempDir, ".htpx", "proxy.port"));
      expect(paths.controlSocketFile).toBe(path.join(tempDir, ".htpx", "control.sock"));
      expect(paths.databaseFile).toBe(path.join(tempDir, ".htpx", "requests.db"));
      expect(paths.caKeyFile).toBe(path.join(tempDir, ".htpx", "ca-key.pem"));
      expect(paths.caCertFile).toBe(path.join(tempDir, ".htpx", "ca.pem"));
      expect(paths.pidFile).toBe(path.join(tempDir, ".htpx", "daemon.pid"));
    });
  });

  describe("proxy port file", () => {
    beforeEach(() => {
      ensureHtpxDir(tempDir);
    });

    it("returns undefined when port file does not exist", () => {
      const result = readProxyPort(tempDir);
      expect(result).toBeUndefined();
    });

    it("writes and reads proxy port", () => {
      writeProxyPort(tempDir, 8080);
      const result = readProxyPort(tempDir);
      expect(result).toBe(8080);
    });

    it("returns undefined for invalid port content", () => {
      const { proxyPortFile } = getHtpxPaths(tempDir);
      fs.writeFileSync(proxyPortFile, "not-a-number");

      const result = readProxyPort(tempDir);
      expect(result).toBeUndefined();
    });
  });

  describe("daemon pid file", () => {
    beforeEach(() => {
      ensureHtpxDir(tempDir);
    });

    it("returns undefined when pid file does not exist", () => {
      const result = readDaemonPid(tempDir);
      expect(result).toBeUndefined();
    });

    it("writes and reads daemon pid", () => {
      writeDaemonPid(tempDir, 12345);
      const result = readDaemonPid(tempDir);
      expect(result).toBe(12345);
    });

    it("removes daemon pid file", () => {
      writeDaemonPid(tempDir, 12345);
      removeDaemonPid(tempDir);

      const result = readDaemonPid(tempDir);
      expect(result).toBeUndefined();
    });

    it("handles removing non-existent pid file", () => {
      // Should not throw
      removeDaemonPid(tempDir);
    });
  });

  describe("isProcessRunning", () => {
    it("returns true for current process", () => {
      const result = isProcessRunning(process.pid);
      expect(result).toBe(true);
    });

    it("returns false for non-existent process", () => {
      // Using a very high PID that's unlikely to exist
      const result = isProcessRunning(999999999);
      expect(result).toBe(false);
    });
  });
});
