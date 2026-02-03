import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Logger, createLogger, parseVerbosity, type LogLevel } from "../../src/shared/logger.js";

describe("Logger", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-logger-test-"));
    logFile = path.join(tempDir, "test.log");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("log writing", () => {
    it("writes JSON log entries to file", () => {
      const logger = new Logger("daemon", logFile, "trace");
      logger.info("Test message");

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe("info");
      expect(entry.component).toBe("daemon");
      expect(entry.msg).toBe("Test message");
    });

    it("appends to existing log file", () => {
      const logger = new Logger("daemon", logFile, "trace");
      logger.info("First message");
      logger.info("Second message");

      const content = fs.readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);
    });

    it("creates log file if it does not exist", () => {
      expect(fs.existsSync(logFile)).toBe(false);

      const logger = new Logger("daemon", logFile, "trace");
      logger.info("Test message");

      expect(fs.existsSync(logFile)).toBe(true);
    });

    it("includes timestamp in ISO 8601 format", () => {
      const logger = new Logger("daemon", logFile, "trace");
      logger.info("Test message");

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    it("includes level, component, and message", () => {
      const logger = new Logger("proxy", logFile, "trace");
      logger.warn("Warning message");

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe("warn");
      expect(entry.component).toBe("proxy");
      expect(entry.msg).toBe("Warning message");
    });

    it("includes optional data field when provided", () => {
      const logger = new Logger("daemon", logFile, "trace");
      logger.info("Request received", { method: "GET", url: "/api/test" });

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.data).toEqual({ method: "GET", url: "/api/test" });
    });

    it("omits data field when not provided", () => {
      const logger = new Logger("daemon", logFile, "trace");
      logger.info("Simple message");

      const content = fs.readFileSync(logFile, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.data).toBeUndefined();
    });
  });

  describe("log level filtering", () => {
    it("logs error at all levels", () => {
      const levels: LogLevel[] = ["error", "warn", "info", "debug", "trace"];

      for (const level of levels) {
        const testFile = path.join(tempDir, `${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.error("Error message");

        expect(fs.existsSync(testFile)).toBe(true);
        const content = fs.readFileSync(testFile, "utf-8");
        expect(content).toContain("Error message");
      }
    });

    it("logs warn at warn level and above", () => {
      // Should log at warn, info, debug, trace
      const shouldLog: LogLevel[] = ["warn", "info", "debug", "trace"];
      for (const level of shouldLog) {
        const testFile = path.join(tempDir, `warn-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.warn("Warning message");
        expect(fs.existsSync(testFile)).toBe(true);
      }

      // Should not log at error level
      const shouldNotLogFile = path.join(tempDir, "warn-error.log");
      const logger = new Logger("daemon", shouldNotLogFile, "error");
      logger.warn("Warning message");
      expect(fs.existsSync(shouldNotLogFile)).toBe(false);
    });

    it("logs info only at info level and above", () => {
      // Should log at info, debug, trace
      const shouldLog: LogLevel[] = ["info", "debug", "trace"];
      for (const level of shouldLog) {
        const testFile = path.join(tempDir, `info-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.info("Info message");
        expect(fs.existsSync(testFile)).toBe(true);
      }

      // Should not log at error, warn levels
      const shouldNotLog: LogLevel[] = ["error", "warn"];
      for (const level of shouldNotLog) {
        const testFile = path.join(tempDir, `info-not-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.info("Info message");
        expect(fs.existsSync(testFile)).toBe(false);
      }
    });

    it("logs debug only at debug level and above", () => {
      // Should log at debug, trace
      const shouldLog: LogLevel[] = ["debug", "trace"];
      for (const level of shouldLog) {
        const testFile = path.join(tempDir, `debug-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.debug("Debug message");
        expect(fs.existsSync(testFile)).toBe(true);
      }

      // Should not log at error, warn, info levels
      const shouldNotLog: LogLevel[] = ["error", "warn", "info"];
      for (const level of shouldNotLog) {
        const testFile = path.join(tempDir, `debug-not-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.debug("Debug message");
        expect(fs.existsSync(testFile)).toBe(false);
      }
    });

    it("logs trace only at trace level", () => {
      // Should log at trace
      const traceFile = path.join(tempDir, "trace-trace.log");
      const traceLogger = new Logger("daemon", traceFile, "trace");
      traceLogger.trace("Trace message");
      expect(fs.existsSync(traceFile)).toBe(true);

      // Should not log at any other level
      const shouldNotLog: LogLevel[] = ["error", "warn", "info", "debug"];
      for (const level of shouldNotLog) {
        const testFile = path.join(tempDir, `trace-not-${level}.log`);
        const logger = new Logger("daemon", testFile, level);
        logger.trace("Trace message");
        expect(fs.existsSync(testFile)).toBe(false);
      }
    });
  });

  describe("log rotation", () => {
    it("rotates log file when size exceeds 10MB", () => {
      const logger = new Logger("daemon", logFile, "trace");

      // Write a large amount of data to exceed 10MB
      const largeData = "x".repeat(1024 * 1024); // 1MB per message
      for (let i = 0; i < 11; i++) {
        logger.info(largeData);
      }

      // Should have rotated, so we should have both files
      expect(fs.existsSync(logFile)).toBe(true);
      expect(fs.existsSync(logFile + ".1")).toBe(true);
    });

    it("deletes old .log.1 file before rotating", () => {
      // Create an existing .log.1 file with specific content
      const rotatedPath = logFile + ".1";
      fs.writeFileSync(rotatedPath, "OLD CONTENT");

      const logger = new Logger("daemon", logFile, "trace");

      // Write enough data to trigger rotation
      const largeData = "x".repeat(1024 * 1024);
      for (let i = 0; i < 11; i++) {
        logger.info(largeData);
      }

      // The .1 file should no longer contain the old content
      const content = fs.readFileSync(rotatedPath, "utf-8");
      expect(content).not.toContain("OLD CONTENT");
    });

    it("renames current log to .log.1", () => {
      const logger = new Logger("daemon", logFile, "trace");

      // Write a message we can identify
      logger.info("MARKER_MESSAGE");

      // Write enough to trigger rotation
      const largeData = "x".repeat(1024 * 1024);
      for (let i = 0; i < 11; i++) {
        logger.info(largeData);
      }

      // The marker should be in the rotated file
      const rotatedContent = fs.readFileSync(logFile + ".1", "utf-8");
      expect(rotatedContent).toContain("MARKER_MESSAGE");
    });

    it("creates fresh log file after rotation", () => {
      const logger = new Logger("daemon", logFile, "trace");

      // Write a message before rotation
      logger.info("BEFORE_ROTATION");

      // Write enough to trigger rotation
      const largeData = "x".repeat(1024 * 1024);
      for (let i = 0; i < 11; i++) {
        logger.info(largeData);
      }

      // Write a message after rotation
      logger.info("AFTER_ROTATION");

      // The current log should not contain the pre-rotation message
      // (it should be in .1)
      const currentContent = fs.readFileSync(logFile, "utf-8");
      expect(currentContent).not.toContain("BEFORE_ROTATION");
      expect(currentContent).toContain("AFTER_ROTATION");
    });

    it("does not rotate when file is under 10MB", () => {
      const logger = new Logger("daemon", logFile, "trace");

      // Write some messages but not enough to exceed 10MB
      for (let i = 0; i < 10; i++) {
        logger.info("Small message");
      }

      // Should not have rotated
      expect(fs.existsSync(logFile)).toBe(true);
      expect(fs.existsSync(logFile + ".1")).toBe(false);
    });
  });
});

describe("createLogger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates logger with correct log file path", () => {
    const logger = createLogger("daemon", tempDir, "trace");
    logger.info("Test message");

    const expectedPath = path.join(tempDir, ".htpx", "htpx.log");
    expect(fs.existsSync(expectedPath)).toBe(true);
  });
});

describe("parseVerbosity", () => {
  it("returns warn for 0", () => {
    expect(parseVerbosity(0)).toBe("warn");
  });

  it("returns info for 1", () => {
    expect(parseVerbosity(1)).toBe("info");
  });

  it("returns debug for 2", () => {
    expect(parseVerbosity(2)).toBe("debug");
  });

  it("returns trace for 3+", () => {
    expect(parseVerbosity(3)).toBe("trace");
    expect(parseVerbosity(4)).toBe("trace");
    expect(parseVerbosity(10)).toBe("trace");
  });
});
