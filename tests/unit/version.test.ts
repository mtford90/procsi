import { describe, it, expect } from "vitest";
import { getHtpxVersion } from "../../src/shared/version.js";

describe("version", () => {
  describe("getHtpxVersion", () => {
    it("returns a string", () => {
      const version = getHtpxVersion();
      expect(typeof version).toBe("string");
    });

    it("returns semantic version format", () => {
      const version = getHtpxVersion();
      // Should match semver pattern like "0.1.0" or "1.2.3-beta.1"
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
