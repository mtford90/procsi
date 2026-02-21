/**
 * Browser detection, extension generation, and launching for proxied browser sessions.
 *
 * Supports Chrome/Chromium and Firefox. Safari is deferred — it requires
 * system-wide proxy settings and macOS Keychain CA trust (elevated permissions).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export type BrowserType = "chrome" | "firefox";

export interface BrowserInfo {
  type: BrowserType;
  /** Human-readable name, e.g. "Google Chrome", "Chromium", "Firefox" */
  name: string;
  execPath: string;
}

export interface LaunchBrowserOptions {
  proxyPort: number;
  caCertPath: string;
  sessionId: string;
  sessionToken: string;
  profileDir: string;
  url?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WHICH_TIMEOUT_MS = 1000;

const FIREFOX_EXTENSION_ID = "procsi@procsi.dev";

/**
 * Known browser executable paths per platform.
 * macOS uses .app bundle paths; Linux uses binary names resolved via `which`.
 */
const KNOWN_BROWSERS: Record<string, { type: BrowserType; name: string; path: string }[]> = {
  darwin: [
    // Chromium-based
    {
      type: "chrome",
      name: "Google Chrome",
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    {
      type: "chrome",
      name: "Brave",
      path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    },
    {
      type: "chrome",
      name: "Microsoft Edge",
      path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    },
    {
      type: "chrome",
      name: "Vivaldi",
      path: "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    },
    {
      type: "chrome",
      name: "Arc",
      path: "/Applications/Arc.app/Contents/MacOS/Arc",
    },
    {
      type: "chrome",
      name: "Chromium",
      path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    },
    // Firefox-based
    {
      type: "firefox",
      name: "Firefox",
      path: "/Applications/Firefox.app/Contents/MacOS/firefox",
    },
    {
      type: "firefox",
      name: "Zen Browser",
      path: "/Applications/Zen.app/Contents/MacOS/zen",
    },
    {
      type: "firefox",
      name: "LibreWolf",
      path: "/Applications/LibreWolf.app/Contents/MacOS/LibreWolf",
    },
  ],
  linux: [
    // Chromium-based
    { type: "chrome", name: "Google Chrome", path: "google-chrome" },
    { type: "chrome", name: "Google Chrome (stable)", path: "google-chrome-stable" },
    { type: "chrome", name: "Brave", path: "brave-browser" },
    { type: "chrome", name: "Microsoft Edge", path: "microsoft-edge" },
    { type: "chrome", name: "Microsoft Edge (stable)", path: "microsoft-edge-stable" },
    { type: "chrome", name: "Vivaldi", path: "vivaldi" },
    { type: "chrome", name: "Vivaldi (stable)", path: "vivaldi-stable" },
    { type: "chrome", name: "Chromium", path: "chromium" },
    { type: "chrome", name: "Chromium (browser)", path: "chromium-browser" },
    // Firefox-based
    { type: "firefox", name: "Firefox", path: "firefox" },
    { type: "firefox", name: "Zen Browser", path: "zen-browser" },
    { type: "firefox", name: "LibreWolf", path: "librewolf" },
  ],
};

// ── Browser Detection ────────────────────────────────────────────────────────

/**
 * Resolve a binary name to its absolute path via `which`.
 * Returns undefined if the binary is not found.
 */
function whichBinary(name: string): string | undefined {
  try {
    const result = execFileSync("which", [name], {
      timeout: WHICH_TIMEOUT_MS,
      encoding: "utf-8",
    });
    const resolved = result.trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect installed browsers on the current system.
 * Returns an array of found browsers, ordered by preference (Chrome first, then Firefox).
 */
export function detectBrowsers(platform: string = process.platform): BrowserInfo[] {
  const candidates = KNOWN_BROWSERS[platform];
  if (!candidates) return [];

  const found: BrowserInfo[] = [];

  for (const candidate of candidates) {
    if (platform === "darwin") {
      // macOS: check if the full path exists
      if (fs.existsSync(candidate.path)) {
        found.push({
          type: candidate.type,
          name: candidate.name,
          execPath: candidate.path,
        });
      }
    } else {
      // Linux: resolve via `which`
      const resolved = whichBinary(candidate.path);
      if (resolved) {
        found.push({
          type: candidate.type,
          name: candidate.name,
          execPath: resolved,
        });
      }
    }
  }

  return found;
}

/**
 * Find a browser matching the preferred name, or return the first available.
 * The preferred string is matched case-insensitively against both the type
 * ("chrome", "firefox") and the human-readable name.
 */
export function findBrowser(browsers: BrowserInfo[], preferred?: string): BrowserInfo | undefined {
  if (browsers.length === 0) return undefined;

  if (!preferred) return browsers[0];

  const needle = preferred.toLowerCase();
  return (
    browsers.find((b) => b.type === needle || b.name.toLowerCase().includes(needle)) ?? undefined
  );
}

// ── Chrome Extension Generator ───────────────────────────────────────────────

/**
 * Generate a Chrome MV3 extension that injects procsi session headers
 * into every outgoing request via declarativeNetRequest.
 */
export function generateChromeExtension(
  dir: string,
  sessionId: string,
  sessionToken: string
): void {
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    manifest_version: 3,
    name: "procsi Session Headers",
    version: "1.0",
    description: "Injects procsi session headers for traffic attribution",
    permissions: ["declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
    declarative_net_request: {
      rule_resources: [
        {
          id: "procsi_rules",
          enabled: true,
          path: "rules.json",
        },
      ],
    },
  };

  const rules = [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "x-procsi-internal-session-id",
            operation: "set",
            value: sessionId,
          },
          {
            header: "x-procsi-internal-session-token",
            operation: "set",
            value: sessionToken,
          },
        ],
      },
      condition: {
        urlFilter: "*",
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "stylesheet",
          "script",
          "image",
          "font",
          "object",
          "xmlhttprequest",
          "ping",
          "media",
          "websocket",
          "webtransport",
          "other",
        ],
      },
    },
  ];

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, "rules.json"), JSON.stringify(rules, null, 2));
}

// ── Firefox Extension Generator ──────────────────────────────────────────────

/**
 * Generate a Firefox MV2 extension that injects procsi session headers
 * via the webRequest API.
 *
 * Firefox requires extensions to be placed in `<profile>/extensions/<id>/`.
 * The `dir` argument should be the extension root directory (already
 * including the extension ID in the path).
 */
export function generateFirefoxExtension(
  dir: string,
  sessionId: string,
  sessionToken: string
): void {
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    manifest_version: 2,
    name: "procsi Session Headers",
    version: "1.0",
    description: "Injects procsi session headers for traffic attribution",
    permissions: ["webRequest", "webRequestBlocking", "<all_urls>"],
    background: {
      scripts: ["background.js"],
    },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
      },
    },
  };

  // Session values are baked directly into the script — no external config needed
  const backgroundJs = `
browser.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    details.requestHeaders.push({
      name: "x-procsi-internal-session-id",
      value: ${JSON.stringify(sessionId)}
    });
    details.requestHeaders.push({
      name: "x-procsi-internal-session-token",
      value: ${JSON.stringify(sessionToken)}
    });
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);
`.trimStart();

  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, "background.js"), backgroundJs);
}

// ── Firefox Profile Generator ────────────────────────────────────────────────

/**
 * Generate a Firefox `user.js` file that pre-configures the profile to use
 * the procsi proxy, allow unsigned extensions, and suppress telemetry prompts.
 */
export function generateFirefoxProfile(
  profileDir: string,
  proxyPort: number,
  _caCertPath: string
): void {
  fs.mkdirSync(profileDir, { recursive: true });

  const prefs = [
    // Manual proxy configuration
    `user_pref("network.proxy.type", 1);`,
    `user_pref("network.proxy.http", "127.0.0.1");`,
    `user_pref("network.proxy.http_port", ${proxyPort});`,
    `user_pref("network.proxy.ssl", "127.0.0.1");`,
    `user_pref("network.proxy.ssl_port", ${proxyPort});`,
    `user_pref("network.proxy.no_proxies_on", "");`,

    // Allow unsigned extensions
    `user_pref("xpinstall.signatures.required", false);`,

    // Suppress first-run and telemetry prompts
    `user_pref("app.normandy.enabled", false);`,
    `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
    `user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);`,
    `user_pref("browser.shell.checkDefaultBrowser", false);`,
    `user_pref("browser.startup.homepage_override.mstone", "ignore");`,

    // Accept the CA cert via enterprise policy workaround —
    // security.enterprise_roots reads from the OS trust store on macOS/Windows,
    // but on Linux we'd need certutil. For now, rely on the SPKI approach
    // for Chrome and accept the cert warning in Firefox.
    `user_pref("security.enterprise_roots.enabled", true);`,
  ];

  fs.writeFileSync(path.join(profileDir, "user.js"), prefs.join("\n") + "\n");
}

// ── SPKI Hash Computation ────────────────────────────────────────────────────

/**
 * Compute the SHA-256 SPKI fingerprint of a PEM-encoded certificate.
 * Used for Chrome's `--ignore-certificate-errors-spki-list` flag,
 * which trusts only the specific CA rather than disabling all cert checks.
 */
export function computeSpkiHash(certPemPath: string): string {
  const pem = fs.readFileSync(certPemPath, "utf-8");
  const cert = new crypto.X509Certificate(pem);

  // cert.publicKey gives us a KeyObject; export as DER (SubjectPublicKeyInfo)
  const spkiDer = cert.publicKey.export({ type: "spki", format: "der" });
  const hash = crypto.createHash("sha256").update(spkiDer).digest("base64");

  return hash;
}

// ── Browser Launcher ─────────────────────────────────────────────────────────

/**
 * Launch a Chrome/Chromium browser pre-configured to use the procsi proxy.
 */
export function launchChrome(info: BrowserInfo, options: LaunchBrowserOptions): ChildProcess {
  const { proxyPort, caCertPath, profileDir, url } = options;

  // Generate the session header extension
  const extensionDir = path.join(profileDir, "extension");
  generateChromeExtension(extensionDir, options.sessionId, options.sessionToken);

  const spkiHash = computeSpkiHash(caCertPath);

  const args = [
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    `--ignore-certificate-errors-spki-list=${spkiHash}`,
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (url) {
    args.push(url);
  }

  return spawn(info.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
}

/**
 * Launch a Firefox browser pre-configured to use the procsi proxy.
 */
export function launchFirefox(info: BrowserInfo, options: LaunchBrowserOptions): ChildProcess {
  const { proxyPort, caCertPath, profileDir, url } = options;

  // Generate proxy profile
  generateFirefoxProfile(profileDir, proxyPort, caCertPath);

  // Generate the session header extension inside the profile's extensions directory
  const extensionDir = path.join(profileDir, "extensions", FIREFOX_EXTENSION_ID);
  generateFirefoxExtension(extensionDir, options.sessionId, options.sessionToken);

  const args = ["--profile", profileDir, "--no-remote"];

  if (url) {
    args.push(url);
  }

  return spawn(info.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
}

/**
 * Launch a browser pre-configured to use the procsi proxy.
 * Dispatches to the appropriate launcher based on browser type.
 */
export function launchBrowser(info: BrowserInfo, options: LaunchBrowserOptions): ChildProcess {
  if (info.type === "chrome") {
    return launchChrome(info, options);
  }
  return launchFirefox(info, options);
}
