/**
 * End-to-end tests for the procsi TUI.
 *
 * These tests spawn real CLI processes using cli-testing-library and assert
 * on terminal output. The TUI uses --ci mode which renders once and exits,
 * as ink's CI mode only outputs on exit.
 *
 * Note: Keyboard interaction tests are limited since cli-testing-library
 * doesn't use PTY and ink disables raw mode in non-TTY environments.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, configure, waitFor } from "cli-testing-library";
import "cli-testing-library/vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ensureProcsiDir, getProcsiPaths } from "../../src/shared/project.js";

// Increase default timeout for async operations
configure({ asyncUtilTimeout: 10000 });

/**
 * Environment variables to enable CI mode for ink and ensure proper output.
 */
const testEnv = {
  ...process.env,
  // Enable CI mode so ink outputs to non-TTY stdout
  CI: "true",
  // Disable colour output for easier text matching
  NO_COLOR: "1",
  // Set reasonable terminal dimensions
  COLUMNS: "120",
  LINES: "40",
};

/**
 * Helper to make an HTTP request through a proxy.
 */
function makeProxiedRequest(
  proxyPort: number,
  url: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: proxyPort,
      path: url,
      method: "GET",
      headers: {
        Host: parsedUrl.host,
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Get the path to the built CLI entry point.
 */
function getCliBinPath(): string {
  return path.resolve(process.cwd(), "dist/cli/index.js");
}

describe("procsi tui e2e", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let testServer: http.Server;
  let testServerPort: number;
  let cleanupFns: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    // Create temp project directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-e2e-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Start a simple test HTTP server
    testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });

    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    testServerPort = (testServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    testServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Create fresh storage for each test
    storage = new RequestRepository(paths.databaseFile);
    cleanupFns = [];
  });

  afterEach(async () => {
    // Run cleanup in reverse order
    for (const fn of cleanupFns.reverse()) {
      await fn();
    }
    storage.close();

    // Clean up any orphaned processes from cli-testing-library
    await cleanup();
  });

  describe("with running daemon", () => {
    let proxyPort: number;

    beforeEach(async () => {
      // Register a session
      const session = storage.registerSession("test", process.pid);

      // Start proxy
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
        label: "e2e-test",
      });
      proxyPort = proxy.port;
      cleanupFns.push(proxy.stop);

      // Write port file so TUI can find it
      fs.writeFileSync(paths.proxyPortFile, String(proxyPort));
      fs.writeFileSync(paths.pidFile, String(process.pid));

      // Start control server
      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort,
      });
      cleanupFns.push(controlServer.close);
    });

    it("displays captured requests", { timeout: 15_000 }, async () => {
      // Make some HTTP requests through the proxy
      await makeProxiedRequest(proxyPort, `http://127.0.0.1:${testServerPort}/users`);
      await makeProxiedRequest(proxyPort, `http://127.0.0.1:${testServerPort}/posts`);

      // Wait for storage to be updated
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Start the TUI with --ci flag to render and exit
      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Verify requests appear in the TUI
      // Paths may be truncated in the narrow list column (e.g. "/users" → "/user"),
      // so match the shorter form which works for both truncated and full display.
      await findByText(/\/user/i);
      await findByText(/\/post/i);
      await findByText(/GET/i);
      await findByText(/200/);
    });

    it("displays request details with method and status", async () => {
      // Make a test request
      await makeProxiedRequest(proxyPort, `http://127.0.0.1:${testServerPort}/api/data`);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Verify request details
      await findByText(/data/i);
      await findByText(/GET/i);
      await findByText(/200/);
    });

    it("shows panel titles with numbers", async () => {
      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Should show numbered panel titles (check for text content)
      // Left panel shows "[1] Requests"
      await findByText(/\[1\] Requests/);
      // Right panel shows accordion sections like "[2] Request", "[3] Request Body", etc.
      await findByText(/\[2\] Request/);
    });

    it("shows keybinding hints in status bar", async () => {
      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Status bar should show keybinding hints (at 80col, hints are truncated)
      await findByText(/j\/k/);
    });

    it("exits with code 0", async () => {
      const result = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Poll until process exits rather than using a fixed sleep
      await waitFor(() => {
        const exitStatus = result.hasExit();
        expect(exitStatus).not.toBeNull();
        expect(exitStatus?.exitCode).toBe(0);
      });
    });
  });

  describe("error states", () => {
    it("shows error when daemon not running", async () => {
      // Don't start proxy/control server - just launch TUI directly
      // The TUI will try to connect to the control socket and fail

      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Should show an error message about daemon not running
      await findByText(/daemon.*not running|start.*intercept/i);
    });

    it("shows error when not in procsi project", async () => {
      // Create a temp directory without .procsi
      const nonProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-noproject-"));

      try {
        const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
          cwd: nonProjectDir,
          spawnOpts: { env: testEnv },
        });

        // Should show an error about not being in a project
        await findByText(/project|init|not in/i);
      } finally {
        fs.rmSync(nonProjectDir, { recursive: true, force: true });
      }
    });

    it("shows retry hint on error", async () => {
      const { findByText } = await render("node", [getCliBinPath(), "tui", "--ci"], {
        cwd: tempDir,
        spawnOpts: { env: testEnv },
      });

      // Should show retry hint
      await findByText(/retry|r.*to/i);
    });
  });
});
