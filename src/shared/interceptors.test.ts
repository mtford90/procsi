import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInterceptorPath } from "./interceptors.js";

const BASE_DIR = "/home/user/project/.procsi/interceptors";

describe("resolveInterceptorPath", () => {
  it("resolves a simple filename inside the directory", () => {
    const result = resolveInterceptorPath(BASE_DIR, "example.ts");
    expect(result).toBe(path.join(BASE_DIR, "example.ts"));
  });

  it("resolves a nested path inside the directory", () => {
    const result = resolveInterceptorPath(BASE_DIR, "api/mock.ts");
    expect(result).toBe(path.join(BASE_DIR, "api", "mock.ts"));
  });

  it("throws on path traversal attempt", () => {
    expect(() => resolveInterceptorPath(BASE_DIR, "../evil.ts")).toThrow(
      "Interceptor path must stay inside .procsi/interceptors/"
    );
  });

  it("throws on absolute path attempt", () => {
    expect(() => resolveInterceptorPath(BASE_DIR, "/etc/passwd")).toThrow(
      "Interceptor path must stay inside .procsi/interceptors/"
    );
  });

  it("throws when extension is not .ts", () => {
    expect(() => resolveInterceptorPath(BASE_DIR, "example.js")).toThrow(
      "Interceptor path must end with .ts"
    );
  });

  it("throws on empty string", () => {
    expect(() => resolveInterceptorPath(BASE_DIR, "")).toThrow("Path is required.");
  });

  it("throws on whitespace-only string", () => {
    expect(() => resolveInterceptorPath(BASE_DIR, "   ")).toThrow("Path is required.");
  });
});
