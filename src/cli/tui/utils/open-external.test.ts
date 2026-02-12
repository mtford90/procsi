import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openInExternalApp } from "./open-external.js";

// Mock child_process module-level to prevent actual process spawning
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

describe("openInExternalApp", () => {
  const TEMP_DIR_NAME = "procsi-exports";
  let procsiExportDir: string;

  beforeEach(() => {
    // The function uses os.tmpdir()/procsi-exports, so we'll work with that real directory
    procsiExportDir = path.join(os.tmpdir(), TEMP_DIR_NAME);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any test files created in the procsi-exports directory
    if (fs.existsSync(procsiExportDir)) {
      const files = fs.readdirSync(procsiExportDir);
      for (const file of files) {
        // Only delete test files (those starting with "test" or "empty.txt")
        if (file.startsWith("test") || file === "empty.txt") {
          try {
            const filePath = path.join(procsiExportDir, file);
            fs.unlinkSync(filePath);
          } catch {
            // Ignore cleanup errors (e.g. file already deleted)
          }
        }
      }
    }
  });

  it("should write temp file and return success", async () => {
    const body = Buffer.from("test content");
    const filename = "test.txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Opened in external app: test.txt");
    expect(result.filePath).toBeDefined();

    // Verify file was written
    const expectedPath = path.join(procsiExportDir, filename);
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.readFileSync(expectedPath, "utf8")).toBe("test content");
  });

  it("should create temp directory if it doesn't exist", async () => {
    const body = Buffer.from("test content");
    const filename = "test-create-dir.txt";

    // Remove directory if it exists
    if (fs.existsSync(procsiExportDir)) {
      fs.rmSync(procsiExportDir, { recursive: true, force: true });
    }

    expect(fs.existsSync(procsiExportDir)).toBe(false);

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);
    expect(fs.existsSync(procsiExportDir)).toBe(true);
    expect(fs.existsSync(path.join(procsiExportDir, filename))).toBe(true);
  });

  it("should reuse temp directory if it already exists", async () => {
    fs.mkdirSync(procsiExportDir, { recursive: true });

    const body = Buffer.from("test content");
    const filename = "test-reuse.txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(procsiExportDir, filename))).toBe(true);
  });

  it("should call spawn with correct platform command on darwin", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
      configurable: true,
    });

    const { spawn } = await import("node:child_process");
    const body = Buffer.from("test");
    const filename = "test-darwin.txt";

    await openInExternalApp(body, filename);

    const expectedPath = path.join(procsiExportDir, filename);
    expect(spawn).toHaveBeenCalledWith("open", [expectedPath], {
      detached: true,
      stdio: "ignore",
    });

    // Restore original platform
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("should call spawn with correct platform command on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });

    const { spawn } = await import("node:child_process");
    const body = Buffer.from("test");
    const filename = "test-win32.txt";

    await openInExternalApp(body, filename);

    const expectedPath = path.join(procsiExportDir, filename);
    expect(spawn).toHaveBeenCalledWith("cmd", ["/c", "start", "", expectedPath], {
      detached: true,
      stdio: "ignore",
    });

    // Restore original platform
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("should call spawn with correct platform command on linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
      configurable: true,
    });

    const { spawn } = await import("node:child_process");
    const body = Buffer.from("test");
    const filename = "test-linux.txt";

    await openInExternalApp(body, filename);

    const expectedPath = path.join(procsiExportDir, filename);
    expect(spawn).toHaveBeenCalledWith("xdg-open", [expectedPath], {
      detached: true,
      stdio: "ignore",
    });

    // Restore original platform
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it("should call unref on spawned child process", async () => {
    const mockUnref = vi.fn();
    const { spawn } = await import("node:child_process");
    vi.mocked(spawn).mockReturnValueOnce({ unref: mockUnref } as never);

    const body = Buffer.from("test");
    const filename = "test-unref.txt";

    await openInExternalApp(body, filename);

    expect(mockUnref).toHaveBeenCalledOnce();
  });

  it("should handle write failures gracefully", async () => {
    // Make temp directory read-only to cause write failure
    fs.mkdirSync(procsiExportDir, { recursive: true });
    fs.chmodSync(procsiExportDir, 0o444);

    const body = Buffer.from("test content");
    const filename = "test-write-fail.txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/EACCES|permission denied/i);
    expect(result.filePath).toBeUndefined();

    // Restore permissions for cleanup
    fs.chmodSync(procsiExportDir, 0o755);
  });

  // Note: Testing mkdir failure with ESM is problematic due to module namespace limitations.
  // The test for write failures (EACCES) covers error handling in the file system operations.

  it("should handle spawn failures gracefully", async () => {
    const { spawn } = await import("node:child_process");
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error("Spawn failed");
    });

    const body = Buffer.from("test content");
    const filename = "test-spawn-fail.txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(false);
    expect(result.message).toBe("Spawn failed");
    expect(result.filePath).toBeUndefined();
  });

  // Note: Testing writeFileSync failure with ESM is problematic due to module namespace limitations.
  // The test for write failures (EACCES) covers error handling in the write operations.

  it("should handle binary content correctly", async () => {
    // Test with binary buffer (PNG header)
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const filename = "test-binary.png";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);

    // Verify binary content was written correctly
    const expectedPath = path.join(procsiExportDir, filename);
    const written = fs.readFileSync(expectedPath);
    expect(written).toEqual(body);
  });

  it("should handle empty buffer", async () => {
    const body = Buffer.from("");
    const filename = "empty.txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);

    const expectedPath = path.join(procsiExportDir, filename);
    const written = fs.readFileSync(expectedPath);
    expect(written.length).toBe(0);
  });

  it("should handle special characters in filename", async () => {
    const body = Buffer.from("test");
    const filename = "test file (1).txt";

    const result = await openInExternalApp(body, filename);

    expect(result.success).toBe(true);
    expect(result.filePath).toContain("test file (1).txt");

    const expectedPath = path.join(procsiExportDir, filename);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("should overwrite existing file with same name", async () => {
    fs.mkdirSync(procsiExportDir, { recursive: true });
    const filePath = path.join(procsiExportDir, "test-overwrite.txt");

    // Write initial content
    fs.writeFileSync(filePath, "old content");

    // Open with new content
    const body = Buffer.from("new content");
    const result = await openInExternalApp(body, "test-overwrite.txt");

    expect(result.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe("new content");
  });
});
