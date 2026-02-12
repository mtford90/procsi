import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get procsi version from package.json.
 */
export function getProcsiVersion(): string {
  try {
    // Find package.json relative to this file (dist/shared/version.js -> package.json)
    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
