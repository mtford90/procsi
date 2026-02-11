import { describe, it, expect } from "vitest";
import { formatUnsetVars } from "./off.js";

describe("formatUnsetVars", () => {
  it("formats single var", () => {
    const result = formatUnsetVars(["FOO"]);
    expect(result).toBe("unset FOO");
  });

  it("formats multiple vars", () => {
    const result = formatUnsetVars(["HTTP_PROXY", "HTTPS_PROXY"]);

    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("unset HTTP_PROXY");
    expect(lines[1]).toBe("unset HTTPS_PROXY");
  });

  it("handles empty array", () => {
    const result = formatUnsetVars([]);
    expect(result).toBe("");
  });

  it("includes all standard htpx env vars", () => {
    const result = formatUnsetVars([
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "SSL_CERT_FILE",
      "REQUESTS_CA_BUNDLE",
      "NODE_EXTRA_CA_CERTS",
      "HTPX_SESSION_ID",
      "HTPX_LABEL",
    ]);

    expect(result).toContain("unset HTTP_PROXY");
    expect(result).toContain("unset HTTPS_PROXY");
    expect(result).toContain("unset SSL_CERT_FILE");
    expect(result).toContain("unset REQUESTS_CA_BUNDLE");
    expect(result).toContain("unset NODE_EXTRA_CA_CERTS");
    expect(result).toContain("unset HTPX_SESSION_ID");
    expect(result).toContain("unset HTPX_LABEL");
  });
});
