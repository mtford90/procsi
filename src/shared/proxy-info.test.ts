import { describe, it, expect } from "vitest";
import { buildProxyInfo } from "./proxy-info.js";

describe("buildProxyInfo", () => {
  it("returns correct proxy URL from port", () => {
    const info = buildProxyInfo(54321, "/path/to/.procsi/ca.pem");
    expect(info.proxyUrl).toBe("http://127.0.0.1:54321");
  });

  it("passes through the CA cert path", () => {
    const info = buildProxyInfo(54321, "/path/to/.procsi/ca.pem");
    expect(info.caCertPath).toBe("/path/to/.procsi/ca.pem");
  });

  it("includes all required env vars in envBlock", () => {
    const info = buildProxyInfo(8080, "/home/user/.procsi/ca.pem");

    expect(info.envBlock).toContain('export HTTP_PROXY="http://127.0.0.1:8080"');
    expect(info.envBlock).toContain('export HTTPS_PROXY="http://127.0.0.1:8080"');
    expect(info.envBlock).toContain('export SSL_CERT_FILE="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export REQUESTS_CA_BUNDLE="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export CURL_CA_BUNDLE="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export NODE_EXTRA_CA_CERTS="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export DENO_CERT="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export CARGO_HTTP_CAINFO="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export GIT_SSL_CAINFO="/home/user/.procsi/ca.pem"');
    expect(info.envBlock).toContain('export AWS_CA_BUNDLE="/home/user/.procsi/ca.pem"');
  });

  it("produces exactly ten lines in envBlock", () => {
    const info = buildProxyInfo(3000, "/tmp/ca.pem");
    const lines = info.envBlock.split("\n");
    expect(lines).toHaveLength(10);
  });

  it("handles different port numbers", () => {
    const info = buildProxyInfo(443, "/cert.pem");
    expect(info.proxyUrl).toBe("http://127.0.0.1:443");
    expect(info.envBlock).toContain("http://127.0.0.1:443");
  });
});
