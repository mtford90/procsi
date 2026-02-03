import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type Component = "daemon" | "tui" | "cli" | "proxy" | "control" | "storage";

interface LogEntry {
  ts: string;
  level: LogLevel;
  component: Component;
  msg: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

// 10MB max file size before rotation
const MAX_LOG_SIZE = 10 * 1024 * 1024;

export class Logger {
  constructor(
    private component: Component,
    private logFile: string,
    private level: LogLevel = "warn"
  ) {}

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this.log("trace", msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    const line = JSON.stringify(entry) + "\n";

    this.rotateIfNeeded();
    this.appendToFile(line);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.level];
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFile)) {
        return;
      }

      const stats = fs.statSync(this.logFile);
      if (stats.size < MAX_LOG_SIZE) {
        return;
      }

      // Perform rotation
      const rotatedPath = this.logFile + ".1";

      // Delete old rotated file if it exists
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }

      // Rename current log to .1
      fs.renameSync(this.logFile, rotatedPath);
    } catch {
      // Ignore rotation errors to avoid breaking logging
    }
  }

  private appendToFile(line: string): void {
    try {
      // Ensure parent directory exists
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.appendFileSync(this.logFile, line, "utf-8");
    } catch {
      // Silently fail if we can't write to log file
    }
  }
}

/**
 * Create a logger for a specific component.
 */
export function createLogger(
  component: Component,
  projectRoot: string,
  level: LogLevel = "warn"
): Logger {
  const logFile = path.join(projectRoot, ".htpx", "htpx.log");
  return new Logger(component, logFile, level);
}

/**
 * Parse verbosity flag count to log level.
 * 0 = warn (default), 1 = info, 2 = debug, 3+ = trace
 */
export function parseVerbosity(verboseCount: number): LogLevel {
  switch (verboseCount) {
    case 0:
      return "warn";
    case 1:
      return "info";
    case 2:
      return "debug";
    default:
      return "trace";
  }
}

/**
 * Check if a string is a valid log level.
 */
export function isValidLogLevel(level: string): level is LogLevel {
  return ["error", "warn", "info", "debug", "trace"].includes(level);
}
