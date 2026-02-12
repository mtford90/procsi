import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger, type LogLevel } from "./logger.js";

export const DEFAULT_MAX_STORED_REQUESTS = 5000;
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL = 2000;

export interface ProcsiConfig {
  /** Max requests to keep in the database before evicting oldest */
  maxStoredRequests: number;
  /** Max body size in bytes to capture per request/response */
  maxBodySize: number;
  /** Max log file size in bytes before rotation */
  maxLogSize: number;
  /** TUI polling interval in ms */
  pollInterval: number;
}

export const DEFAULT_CONFIG: ProcsiConfig = {
  maxStoredRequests: DEFAULT_MAX_STORED_REQUESTS,
  maxBodySize: DEFAULT_MAX_BODY_SIZE,
  maxLogSize: DEFAULT_MAX_LOG_SIZE,
  pollInterval: DEFAULT_POLL_INTERVAL,
};

/**
 * Validate that a value is a positive integer.
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Validate a parsed config object, returning only valid fields merged with defaults.
 */
function validateConfig(raw: Record<string, unknown>): ProcsiConfig {
  const config = { ...DEFAULT_CONFIG };

  if ("maxStoredRequests" in raw) {
    if (isPositiveInteger(raw["maxStoredRequests"])) {
      config.maxStoredRequests = raw["maxStoredRequests"];
    }
  }

  if ("maxBodySize" in raw) {
    if (isPositiveInteger(raw["maxBodySize"])) {
      config.maxBodySize = raw["maxBodySize"];
    }
  }

  if ("maxLogSize" in raw) {
    if (isPositiveInteger(raw["maxLogSize"])) {
      config.maxLogSize = raw["maxLogSize"];
    }
  }

  if ("pollInterval" in raw) {
    if (isPositiveInteger(raw["pollInterval"])) {
      config.pollInterval = raw["pollInterval"];
    }
  }

  return config;
}

/**
 * Load the project configuration from `.procsi/config.json`.
 *
 * Returns defaults if the file is missing. Logs a warning and returns defaults
 * if the JSON is malformed or contains invalid values.
 */
export function loadConfig(projectRoot: string, logLevel?: LogLevel): ProcsiConfig {
  const configPath = path.join(projectRoot, ".procsi", "config.json");

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const logger = createLogger("daemon", projectRoot, logLevel);
    logger.warn("Malformed config.json, using defaults");
    logger.close();
    return { ...DEFAULT_CONFIG };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    const logger = createLogger("daemon", projectRoot, logLevel);
    logger.warn("config.json must be an object, using defaults");
    logger.close();
    return { ...DEFAULT_CONFIG };
  }

  return validateConfig(parsed as Record<string, unknown>);
}
