import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createInterceptorLoader, isValidInterceptor } from "./interceptor-loader.js";
import type { Interceptor } from "../shared/types.js";

describe("interceptor-loader", () => {
  let tempDir: string;
  let interceptorsDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `procsi-test-${crypto.randomUUID()}`);
    interceptorsDir = tempDir;
    fs.mkdirSync(interceptorsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("isValidInterceptor", () => {
    it("should return true for valid interceptor with handler only", () => {
      const interceptor = {
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(true);
    });

    it("should return true for valid interceptor with handler and name", () => {
      const interceptor = {
        name: "test-interceptor",
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(true);
    });

    it("should return true for valid interceptor with handler, name, and match", () => {
      const interceptor = {
        name: "test-interceptor",
        match: () => true,
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isValidInterceptor(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isValidInterceptor(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isValidInterceptor("string")).toBe(false);
      expect(isValidInterceptor(42)).toBe(false);
      expect(isValidInterceptor(true)).toBe(false);
    });

    it("should return false for object without handler", () => {
      expect(isValidInterceptor({ name: "test" })).toBe(false);
    });

    it("should return false for object with non-function handler", () => {
      expect(isValidInterceptor({ handler: "not a function" })).toBe(false);
      expect(isValidInterceptor({ handler: 42 })).toBe(false);
    });

    it("should return false for object with non-string name", () => {
      const interceptor = {
        name: 42,
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(false);
    });

    it("should return false for object with non-function match", () => {
      const interceptor = {
        match: "not a function",
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(false);
    });
  });

  describe("createInterceptorLoader", { timeout: 15_000 }, () => {
    it("should load single interceptor with ESM default export", async () => {
      const filePath = path.join(interceptorsDir, "test-01.ts");
      fs.writeFileSync(
        filePath,
        `
        export default {
          name: "test-interceptor",
          handler: () => undefined,
        };
        `
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(1);
        expect(interceptors[0].name).toBe("test-interceptor");
        expect(interceptors[0].sourceFile).toBe(filePath);
        expect(typeof interceptors[0].handler).toBe("function");
      } finally {
        loader.close();
      }
    });

    it("should load array of interceptors from default export", async () => {
      const filePath = path.join(interceptorsDir, "test-02.ts");
      fs.writeFileSync(
        filePath,
        `
        export default [
          {
            name: "interceptor-a",
            handler: () => undefined,
          },
          {
            name: "interceptor-b",
            handler: () => undefined,
          },
        ];
        `
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(2);
        expect(interceptors[0].name).toBe("interceptor-a");
        expect(interceptors[1].name).toBe("interceptor-b");
      } finally {
        loader.close();
      }
    });

    it("should load CommonJS module.exports format", async () => {
      const filePath = path.join(interceptorsDir, "test-03.ts");
      fs.writeFileSync(
        filePath,
        `
        module.exports = {
          name: "cjs-interceptor",
          handler: () => undefined,
        };
        `
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(1);
        expect(interceptors[0].name).toBe("cjs-interceptor");
      } finally {
        loader.close();
      }
    });

    it("should merge multiple files in alphabetical order", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "c-third.ts"),
        `export default { name: "third", handler: () => undefined };`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "a-first.ts"),
        `export default { name: "first", handler: () => undefined };`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "b-second.ts"),
        `export default { name: "second", handler: () => undefined };`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(3);
        expect(interceptors[0].name).toBe("first");
        expect(interceptors[1].name).toBe("second");
        expect(interceptors[2].name).toBe("third");
      } finally {
        loader.close();
      }
    });

    it("should skip file with syntax error and load others", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "a-valid.ts"),
        `export default { name: "valid", handler: () => undefined };`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "b-broken.ts"),
        `export default { this is not valid typescript`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "c-also-valid.ts"),
        `export default { name: "also-valid", handler: () => undefined };`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(2);
        expect(interceptors[0].name).toBe("valid");
        expect(interceptors[1].name).toBe("also-valid");

        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(3);
        const brokenInfo = info.find((i) => i.sourceFile.includes("b-broken.ts"));
        expect(brokenInfo).toBeDefined();
        expect(brokenInfo?.error).toBeDefined();
      } finally {
        loader.close();
      }
    });

    it("should reject interceptor with missing handler", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "no-handler.ts"),
        `export default { name: "no-handler" };`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(0);

        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(1);
        expect(info[0].error).toBeDefined();
        expect(info[0].error).toContain("missing valid handler");
      } finally {
        loader.close();
      }
    });

    it("should reject non-object export", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "non-object.ts"),
        `export default "not an object";`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(0);

        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(1);
        expect(info[0].error).toBeDefined();
        expect(info[0].error).toContain("unexpected export type");
      } finally {
        loader.close();
      }
    });

    it("should skip file that throws on import", async () => {
      fs.writeFileSync(path.join(interceptorsDir, "throws.ts"), `throw new Error("Import error");`);
      fs.writeFileSync(
        path.join(interceptorsDir, "valid.ts"),
        `export default { name: "valid", handler: () => undefined };`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(1);
        expect(interceptors[0].name).toBe("valid");

        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(2);
        const throwsInfo = info.find((i) => i.sourceFile.includes("throws.ts"));
        expect(throwsInfo).toBeDefined();
        expect(throwsInfo?.error).toBeDefined();
      } finally {
        loader.close();
      }
    });

    it("should load both interceptors with duplicate names and warn", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "a-duplicate.ts"),
        `export default { name: "duplicate", handler: () => undefined };`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "b-duplicate.ts"),
        `export default { name: "duplicate", handler: () => undefined };`
      );

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(2);
        expect(interceptors[0].name).toBe("duplicate");
        expect(interceptors[1].name).toBe("duplicate");
      } finally {
        loader.close();
      }
    });

    it("should return correct metadata via getInterceptorInfo", async () => {
      const validPath = path.join(interceptorsDir, "a-valid.ts");
      const invalidPath = path.join(interceptorsDir, "b-invalid.ts");

      fs.writeFileSync(
        validPath,
        `export default { name: "valid", match: () => true, handler: () => undefined };`
      );
      fs.writeFileSync(invalidPath, `export default { name: "invalid" };`);

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(2);

        const validInfo = info.find((i) => i.name === "valid");
        expect(validInfo).toBeDefined();
        expect(validInfo?.hasMatch).toBe(true);
        expect(validInfo?.sourceFile).toBe(validPath);
        expect(validInfo?.error).toBeUndefined();

        const invalidInfo = info.find((i) => i.sourceFile === invalidPath);
        expect(invalidInfo).toBeDefined();
        expect(invalidInfo?.error).toBeDefined();
      } finally {
        loader.close();
      }
    });

    it("should handle non-existent directory gracefully", async () => {
      const nonExistentDir = path.join(tempDir, "does-not-exist");

      const loader = await createInterceptorLoader({
        interceptorsDir: nonExistentDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(0);

        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(0);
      } finally {
        loader.close();
      }
    });

    it("should handle interceptor without name using filename", async () => {
      const filePath = path.join(interceptorsDir, "unnamed.ts");
      fs.writeFileSync(filePath, `export default { handler: () => undefined };`);

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const info = loader.getInterceptorInfo();
        expect(info).toHaveLength(1);
        expect(info[0].name).toBe("unnamed.ts");
        expect(info[0].hasMatch).toBe(false);
      } finally {
        loader.close();
      }
    });

    it("should reload interceptors via reload() method", async () => {
      const file1Path = path.join(interceptorsDir, "reload-v1.ts");
      fs.writeFileSync(file1Path, `export default { name: "v1", handler: () => undefined };`);

      const onReload = vi.fn();
      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
        onReload,
      });

      try {
        expect(loader.getInterceptors()).toHaveLength(1);
        expect(loader.getInterceptors()[0].name).toBe("v1");

        // Remove old file and add new one with different name
        fs.unlinkSync(file1Path);
        const file2Path = path.join(interceptorsDir, "reload-v2.ts");
        fs.writeFileSync(file2Path, `export default { name: "v2", handler: () => undefined };`);

        // Manually trigger reload
        await loader.reload();

        expect(onReload).toHaveBeenCalled();
        expect(loader.getInterceptors()).toHaveLength(1);
        expect(loader.getInterceptors()[0].name).toBe("v2");
      } finally {
        loader.close();
      }
    });

    it("should ignore non-.ts files", async () => {
      fs.writeFileSync(
        path.join(interceptorsDir, "valid.ts"),
        `export default { name: "valid", handler: () => undefined };`
      );
      fs.writeFileSync(
        path.join(interceptorsDir, "ignored.js"),
        `export default { name: "ignored", handler: () => undefined };`
      );
      fs.writeFileSync(path.join(interceptorsDir, "README.md"), `# Documentation`);

      const loader = await createInterceptorLoader({
        interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });

      try {
        const interceptors = loader.getInterceptors();
        expect(interceptors).toHaveLength(1);
        expect(interceptors[0].name).toBe("valid");
      } finally {
        loader.close();
      }
    });

    it("should validate interceptor with match function", async () => {
      const interceptor: Interceptor = {
        name: "test",
        match: () => true,
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(true);
    });

    it("should validate interceptor without match function", async () => {
      const interceptor: Interceptor = {
        name: "test",
        handler: () => undefined,
      };
      expect(isValidInterceptor(interceptor)).toBe(true);
    });
  });
});
