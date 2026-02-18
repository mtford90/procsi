import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { ensureProcsiDir, getProcsiPaths } from "../../src/shared/project.js";
import { writePythonOverride } from "../../src/overrides/python.js";
import { writeRubyOverride } from "../../src/overrides/ruby.js";
import { writePhpOverride } from "../../src/overrides/php.js";

const execFileAsync = promisify(execFile);

/** Milliseconds to wait for async storage writes after a child process exits. */
const STORAGE_SETTLE_MS = 200;

/** Child process timeout in milliseconds. */
const CHILD_TIMEOUT_MS = 30_000;

/**
 * Check whether a runtime binary is available on the system PATH.
 * Returns true if the binary can be resolved via `which` (or `where` on Windows).
 */
function hasRuntime(cmd: string): boolean {
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    execFileSync(whichCmd, [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared test harness for verifying that different runtimes route HTTP
 * traffic through the procsi proxy. Each describe block spins up an
 * upstream HTTP server + proxy, spawns a child process with the correct
 * env vars, and asserts the request was captured in storage.
 */
function setupTestHarness() {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  /** Port of the upstream test server */
  let upstreamPort: number;
  /** Port of the procsi proxy */
  let proxyPort: number;
  /** Proxy URL for env vars */
  let proxyUrl: string;
  /** Session credentials injected by procsi on */
  let procsiSessionId: string;
  let procsiSessionToken: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-runtime-overrides-test-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Create storage
    storage = new RequestRepository(paths.databaseFile);
    const session = storage.registerSession("test", process.pid, "shell");
    procsiSessionId = session.id;
    procsiSessionToken = session.token;

    // Start upstream test server
    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: req.url, method: req.method, body }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    upstreamPort = (testServer.address() as { port: number }).port;
    cleanup.push(() => {
      testServer.closeAllConnections();
      return new Promise((resolve) => testServer.close(() => resolve()));
    });

    // Start proxy
    const proxy = await createProxy({
      caKeyPath: paths.caKeyFile,
      caCertPath: paths.caCertFile,
      storage,
      sessionId: session.id,
    });
    proxyPort = proxy.port;
    proxyUrl = `http://127.0.0.1:${proxyPort}`;
    cleanup.push(proxy.stop);

    cleanup = cleanup.reverse();
  });

  afterEach(async () => {
    for (const fn of cleanup) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    cleanup = [];
  });

  /**
   * Build the env block for a child process with all proxy and CA env vars.
   * Covers the standard proxy vars, runtime-specific CA vars, and procsi
   * session credentials.
   */
  function buildChildEnv(extra?: Record<string, string>): Record<string, string> {
    return {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      // Standard proxy env vars (upper and lower case)
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      // CA certificate env vars for various runtimes and tools
      SSL_CERT_FILE: paths.caCertFile,
      REQUESTS_CA_BUNDLE: paths.caCertFile,
      CURL_CA_BUNDLE: paths.caCertFile,
      NODE_EXTRA_CA_CERTS: paths.caCertFile,
      DENO_CERT: paths.caCertFile,
      CARGO_HTTP_CAINFO: paths.caCertFile,
      GIT_SSL_CAINFO: paths.caCertFile,
      AWS_CA_BUNDLE: paths.caCertFile,
      // CGI-specific proxy var (some runtimes honour this)
      CGI_HTTP_PROXY: proxyUrl,
      // procsi session credentials
      PROCSI_SESSION_ID: procsiSessionId,
      PROCSI_SESSION_TOKEN: procsiSessionToken,
      ...extra,
    };
  }

  return {
    get tempDir() {
      return tempDir;
    },
    get paths() {
      return paths;
    },
    get storage() {
      return storage;
    },
    get upstreamPort() {
      return upstreamPort;
    },
    get proxyPort() {
      return proxyPort;
    },
    get proxyUrl() {
      return proxyUrl;
    },
    buildChildEnv,
  };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("python3"))("python overrides integration", () => {
  const harness = setupTestHarness();

  it("routes urllib.request.urlopen() through the proxy", async () => {
    // Write the Python override (sitecustomize.py) so httplib2 is patched
    const pythonOverrideDir = writePythonOverride(
      harness.paths.pythonOverrideDir,
      harness.paths.caCertFile
    );

    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/python-test`;

    const script = `import urllib.request; urllib.request.urlopen('${targetUrl}')`;

    await execFileAsync("python3", ["-c", script], {
      env: harness.buildChildEnv({
        PYTHONPATH: pythonOverrideDir,
      }),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/python-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("go"))("go overrides integration", () => {
  const harness = setupTestHarness();

  it("routes net/http.Get() through the proxy", { timeout: CHILD_TIMEOUT_MS }, async () => {
    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/go-test`;

    // Write a temporary Go source file.
    // Go's net/http.ProxyFromEnvironment skips proxying for loopback
    // addresses, so we configure a custom Transport that always proxies.
    const goSource = `package main

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
)

func main() {
	proxyURL, err := url.Parse(os.Getenv("HTTP_PROXY"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "bad proxy URL: %v\\n", err)
		os.Exit(1)
	}
	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
	}
	resp, err := client.Get("${targetUrl}")
	if err != nil {
		fmt.Fprintf(os.Stderr, "request failed: %v\\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		os.Exit(1)
	}
}
`;

    const goFile = path.join(harness.tempDir, "proxy_main.go");
    fs.writeFileSync(goFile, goSource, "utf-8");

    await execFileAsync("go", ["run", goFile], {
      env: harness.buildChildEnv({
        // Go needs GOPATH and GOROOT to compile; inherit from host
        GOPATH: process.env["GOPATH"] ?? path.join(os.homedir(), "go"),
        GOROOT: process.env["GOROOT"] ?? "",
        GOCACHE: process.env["GOCACHE"] ?? path.join(os.tmpdir(), "go-build"),
        GOMODCACHE: process.env["GOMODCACHE"] ?? "",
        // Go modules off since this is a standalone file
        GO111MODULE: "off",
      }),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/go-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Deno
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("deno"))("deno overrides integration", () => {
  const harness = setupTestHarness();

  it("routes fetch() through the proxy", async () => {
    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/deno-test`;

    const script = `await fetch('${targetUrl}')`;

    await execFileAsync("deno", ["eval", script], {
      env: harness.buildChildEnv(),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/deno-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Bun
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("bun"))("bun overrides integration", () => {
  const harness = setupTestHarness();

  it("routes fetch() through the proxy", async () => {
    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/bun-test`;

    const script = `await fetch('${targetUrl}')`;

    await execFileAsync("bun", ["-e", script], {
      env: harness.buildChildEnv(),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/bun-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("ruby"))("ruby overrides integration", () => {
  const harness = setupTestHarness();

  it("routes Net::HTTP.get() through the proxy", async () => {
    // Write the Ruby override script so OpenSSL trusts the proxy CA
    const rubyOverrideDir = path.dirname(harness.paths.rubyOverrideFile);
    const rubyOverridePath = writeRubyOverride(rubyOverrideDir, harness.paths.caCertFile);

    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/ruby-test`;

    // Ruby's URI::Generic#find_proxy skips proxy for 127.0.0.0/8 addresses,
    // so we must explicitly pass the proxy host/port to Net::HTTP.start.
    const script = [
      `require 'net/http'`,
      `require 'uri'`,
      `proxy = URI(ENV['HTTP_PROXY'])`,
      `uri = URI('${targetUrl}')`,
      `Net::HTTP.start(uri.host, uri.port, proxy.host, proxy.port) { |http| http.get(uri.path) }`,
    ].join("; ");

    await execFileAsync("ruby", ["-e", script], {
      env: harness.buildChildEnv({
        RUBYOPT: `-r ${rubyOverridePath}`,
      }),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/ruby-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

describe.skipIf(!hasRuntime("php"))("php overrides integration", () => {
  const harness = setupTestHarness();

  it("routes file_get_contents() through the proxy", async () => {
    // Write the PHP override INI so curl/openssl trust the proxy CA
    const phpOverrideDir = writePhpOverride(harness.paths.phpOverrideDir, harness.paths.caCertFile);

    const targetUrl = `http://127.0.0.1:${harness.upstreamPort}/php-test`;

    // PHP's file_get_contents() does not honour HTTP_PROXY env vars
    // automatically — we must configure a stream context explicitly.
    const script = [
      `$proxy = getenv('HTTP_PROXY');`,
      `$parts = parse_url($proxy);`,
      `$ctx = stream_context_create(['http' => [`,
      `  'proxy' => 'tcp://' . $parts['host'] . ':' . $parts['port'],`,
      `  'request_fulluri' => true,`,
      `]]);`,
      `file_get_contents('${targetUrl}', false, $ctx);`,
    ].join(" ");

    await execFileAsync("php", ["-r", script], {
      env: harness.buildChildEnv({
        // Prepend with : so PHP scans the default dir first, then ours
        PHP_INI_SCAN_DIR: `:${phpOverrideDir}`,
      }),
      timeout: CHILD_TIMEOUT_MS,
    });

    await new Promise((resolve) => setTimeout(resolve, STORAGE_SETTLE_MS));

    const requests = harness.storage.listRequests();
    const captured = requests.find((r) => r.path === "/php-test");
    expect(captured).toBeDefined();
    expect(captured?.method).toBe("GET");
    expect(captured?.responseStatus).toBe(200);
  });
});
