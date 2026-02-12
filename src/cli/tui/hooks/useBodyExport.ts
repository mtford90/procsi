/**
 * Hook for saving body content to disk.
 */

import { useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { copyToClipboard } from "../utils/clipboard.js";
import { findOrCreateProjectRoot, ensureProcsiDir } from "../../../shared/project.js";

export type SaveLocation = "exports" | "downloads" | "custom";

export interface ExportResult {
  success: boolean;
  message: string;
  filePath?: string;
}

/**
 * Generate a filename for body content based on request metadata.
 */
export function generateFilename(
  requestId: string,
  contentType: string | undefined,
  url: string
): string {
  // Try to extract extension from URL first
  let extension = "";

  try {
    const urlPath = new URL(url).pathname;
    const urlExtMatch = urlPath.match(/\.([a-zA-Z0-9]+)$/);
    if (urlExtMatch?.[1]) {
      extension = urlExtMatch[1].toLowerCase();
    }
  } catch {
    // Invalid URL, fall through to content-type detection
  }

  if (!extension && contentType) {
    extension = getExtensionFromContentType(contentType);
  }

  // Generate timestamp for uniqueness
  const timestamp = Date.now();
  const shortId = requestId.slice(0, 8);

  return extension ? `${shortId}-${timestamp}.${extension}` : `${shortId}-${timestamp}.bin`;
}

/**
 * Map common content types to file extensions.
 */
function getExtensionFromContentType(contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  const mappings: Record<string, string> = {
    // Text
    "application/json": "json",
    "text/html": "html",
    "text/css": "css",
    "text/javascript": "js",
    "application/javascript": "js",
    "text/xml": "xml",
    "application/xml": "xml",
    "text/plain": "txt",
    "text/csv": "csv",

    // Images
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/bmp": "bmp",
    "image/tiff": "tiff",

    // Audio
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "weba",
    "audio/aac": "aac",
    "audio/flac": "flac",

    // Video
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",

    // Documents
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",

    // Archives
    "application/zip": "zip",
    "application/gzip": "gz",
    "application/x-tar": "tar",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",

    // Other
    "application/octet-stream": "bin",
    "application/wasm": "wasm",
  };

  return mappings[type] ?? "bin";
}

/**
 * Resolve the target directory based on save location.
 */
function resolveTargetDir(location: SaveLocation, customPath?: string): string {
  switch (location) {
    case "exports": {
      const projectRoot = findOrCreateProjectRoot();
      const procsiDir = ensureProcsiDir(projectRoot);
      const exportsDir = path.join(procsiDir, "exports");
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }
      return exportsDir;
    }
    case "downloads": {
      const downloadsDir = path.join(os.homedir(), "Downloads");
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }
      return downloadsDir;
    }
    case "custom": {
      if (!customPath) {
        throw new Error("Custom path required");
      }
      // Expand ~ to home directory
      const expandedPath = customPath.startsWith("~")
        ? path.join(os.homedir(), customPath.slice(1))
        : customPath;
      const resolvedPath = path.resolve(expandedPath);
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }
      return resolvedPath;
    }
  }
}

/**
 * Save body content to disk.
 */
export async function saveBodyContent(
  body: Buffer,
  filename: string,
  location: SaveLocation,
  customPath?: string
): Promise<ExportResult> {
  try {
    const targetDir = resolveTargetDir(location, customPath);
    const filePath = path.join(targetDir, filename);

    fs.writeFileSync(filePath, body);

    // Copy path to clipboard
    try {
      await copyToClipboard(filePath);
      return {
        success: true,
        message: `Saved to ${filePath} (path copied)`,
        filePath,
      };
    } catch {
      // Clipboard failed but file was saved
      return {
        success: true,
        message: `Saved to ${filePath}`,
        filePath,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to save file",
    };
  }
}

interface UseBodyExportResult {
  saveBody: (
    body: Buffer,
    requestId: string,
    contentType: string | undefined,
    url: string,
    location: SaveLocation,
    customPath?: string
  ) => Promise<ExportResult>;
}

/**
 * Hook providing body export/save functionality.
 */
export function useBodyExport(): UseBodyExportResult {
  const saveBody = useCallback(
    async (
      body: Buffer,
      requestId: string,
      contentType: string | undefined,
      url: string,
      location: SaveLocation,
      customPath?: string
    ): Promise<ExportResult> => {
      const filename = generateFilename(requestId, contentType, url);
      return saveBodyContent(body, filename, location, customPath);
    },
    []
  );

  return { saveBody };
}
