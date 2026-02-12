import * as fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Resolve the absolute filesystem path to a dependency installed
 * within procsi's own node_modules. Uses `createRequire` so the
 * resolution is relative to *this* package, not the user's project.
 */
export function resolveDependencyPath(dep: string): string {
  return require.resolve(dep);
}

/**
 * Generate the contents of the CJS preload script that patches
 * Node.js `http`/`https` global agents and native `fetch()` to
 * route through the proxy specified by env vars.
 *
 * Absolute paths to procsi's own `global-agent` and `undici` are
 * baked in so the script works regardless of the user's project
 * dependencies.
 */
export function generateNodePreloadScript(): string {
  const globalAgentPath = resolveDependencyPath("global-agent");
  const undiciPath = resolveDependencyPath("undici");

  // Backslash-escape paths for Windows compatibility inside JS strings
  const escapedGlobalAgentPath = globalAgentPath.replace(/\\/g, "\\\\");
  const escapedUndiciPath = undiciPath.replace(/\\/g, "\\\\");

  return [
    "'use strict';",
    "// Patch http.globalAgent/https.globalAgent to route through proxy",
    "try {",
    `  require('${escapedGlobalAgentPath}').bootstrap();`,
    "} catch (_) {}",
    "",
    "// Patch native fetch() to route through proxy",
    "try {",
    `  var undici = require('${escapedUndiciPath}');`,
    "  undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());",
    "} catch (_) {}",
    "",
  ].join("\n");
}

/**
 * Write the CJS preload script to the given path (typically
 * `.procsi/proxy-preload.cjs`). Creates parent directories if needed.
 *
 * Returns the absolute path written to.
 */
export function writeNodePreloadScript(outputPath: string): string {
  fs.writeFileSync(outputPath, generateNodePreloadScript(), "utf-8");
  return outputPath;
}

/**
 * Return the Node.js-specific environment variables that should be
 * set alongside the standard proxy vars. These ensure `global-agent`
 * and future Node versions pick up the proxy URL.
 */
export function getNodeEnvVars(proxyUrl: string): Record<string, string> {
  return {
    // global-agent uses its own env var names by design
    GLOBAL_AGENT_HTTP_PROXY: proxyUrl,
    GLOBAL_AGENT_HTTPS_PROXY: proxyUrl,
    // Future-proofing for Node 24+ which will natively respect proxy env vars
    NODE_USE_ENV_PROXY: "1",
  };
}
