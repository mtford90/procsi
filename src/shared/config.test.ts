import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-config-test-"));
    fs.mkdirSync(path.join(tempDir, ".procsi"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns a fresh copy of defaults (not the same reference)", () => {
    const config1 = loadConfig(tempDir);
    const config2 = loadConfig(tempDir);
    expect(config1).not.toBe(config2);
  });

  it("loads and merges partial config", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({ maxStoredRequests: 1000 })
    );

    const config = loadConfig(tempDir);
    expect(config.maxStoredRequests).toBe(1000);
    expect(config.maxBodySize).toBe(DEFAULT_CONFIG.maxBodySize);
    expect(config.maxLogSize).toBe(DEFAULT_CONFIG.maxLogSize);
    expect(config.pollInterval).toBe(DEFAULT_CONFIG.pollInterval);
  });

  it("loads full config", () => {
    const custom = {
      maxStoredRequests: 2000,
      maxBodySize: 5242880,
      maxLogSize: 1048576,
      pollInterval: 500,
    };
    fs.writeFileSync(path.join(tempDir, ".procsi", "config.json"), JSON.stringify(custom));

    const config = loadConfig(tempDir);
    expect(config).toEqual(custom);
  });

  it("returns defaults on malformed JSON", () => {
    fs.writeFileSync(path.join(tempDir, ".procsi", "config.json"), "not valid json {{{");

    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config is an array", () => {
    fs.writeFileSync(path.join(tempDir, ".procsi", "config.json"), JSON.stringify([1, 2, 3]));

    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config is null", () => {
    fs.writeFileSync(path.join(tempDir, ".procsi", "config.json"), "null");

    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("ignores negative numbers", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({ maxStoredRequests: -100 })
    );

    const config = loadConfig(tempDir);
    expect(config.maxStoredRequests).toBe(DEFAULT_CONFIG.maxStoredRequests);
  });

  it("ignores zero values", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({ pollInterval: 0 })
    );

    const config = loadConfig(tempDir);
    expect(config.pollInterval).toBe(DEFAULT_CONFIG.pollInterval);
  });

  it("ignores non-integer numbers", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({ maxStoredRequests: 100.5 })
    );

    const config = loadConfig(tempDir);
    expect(config.maxStoredRequests).toBe(DEFAULT_CONFIG.maxStoredRequests);
  });

  it("ignores wrong types", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({
        maxStoredRequests: "lots",
        maxBodySize: true,
        maxLogSize: null,
        pollInterval: [1000],
      })
    );

    const config = loadConfig(tempDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("ignores unknown fields", () => {
    fs.writeFileSync(
      path.join(tempDir, ".procsi", "config.json"),
      JSON.stringify({ unknownField: 42, maxStoredRequests: 3000 })
    );

    const config = loadConfig(tempDir);
    expect(config.maxStoredRequests).toBe(3000);
    expect("unknownField" in config).toBe(false);
  });
});
