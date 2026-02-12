/**
 * Open files in the platform's default external application.
 *
 * Writes body to a temp file then opens it with the OS default handler.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const TEMP_DIR_NAME = "procsi-exports";

interface OpenResult {
  success: boolean;
  message: string;
  filePath?: string;
}

/**
 * Get the platform-specific command for opening files with the default app.
 */
function getOpenCommand(): { command: string; args: string[] } {
  const platform = process.platform;

  if (platform === "darwin") {
    return { command: "open", args: [] };
  } else if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", ""] };
  } else {
    return { command: "xdg-open", args: [] };
  }
}

/**
 * Write body to a temp file and open it with the platform's default application.
 * The spawned process is detached so it doesn't block the TUI.
 */
export async function openInExternalApp(body: Buffer, filename: string): Promise<OpenResult> {
  try {
    const tempDir = path.join(os.tmpdir(), TEMP_DIR_NAME);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, body);

    const { command, args } = getOpenCommand();

    const child = spawn(command, [...args, filePath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return {
      success: true,
      message: `Opened in external app: ${filename}`,
      filePath,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to open externally",
    };
  }
}
