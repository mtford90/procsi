/**
 * Binary content detection utilities.
 *
 * Determines whether a buffer contains binary or text content based on
 * Content-Type headers and byte scanning.
 */

import { TEXT_CONTENT_TYPES, TEXT_SUFFIXES } from "../../../shared/content-type.js";

/**
 * Content types that are definitively binary.
 */
const BINARY_CONTENT_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-word",
  "application/vnd.openxmlformats-officedocument",
  "application/x-shockwave-flash",
  "application/wasm",
  "font/",
];

/**
 * Human-readable descriptions for binary content types.
 */
const BINARY_DESCRIPTIONS: Record<string, string> = {
  "image/": "Image",
  "audio/": "Audio",
  "video/": "Video",
  "font/": "Font",
  "application/pdf": "PDF",
  "application/zip": "Archive",
  "application/gzip": "Archive",
  "application/x-tar": "Archive",
  "application/x-rar-compressed": "Archive",
  "application/x-7z-compressed": "Archive",
  "application/wasm": "WebAssembly",
};

export interface BinaryCheckResult {
  isBinary: boolean;
  reason: "content-type" | "content-scan" | "text-content-type";
}

/**
 * Check if content is binary based on Content-Type and/or byte scanning.
 *
 * Detection logic:
 * 1. Check Content-Type against text whitelist - if match, return not binary
 * 2. Check Content-Type against binary patterns - if match, return binary
 * 3. Fall back to scanning first 8KB for >10% non-printable characters
 */
export function isBinaryContent(
  body: Buffer | undefined,
  contentType: string | undefined
): BinaryCheckResult {
  // No body means not binary (nothing to display)
  if (!body || body.length === 0) {
    return { isBinary: false, reason: "text-content-type" };
  }

  // Normalise content type (remove charset and other parameters)
  const normalisedType = contentType?.split(";")[0]?.trim().toLowerCase();

  // Check text content types first
  if (normalisedType) {
    // Check prefixes
    let isTextContentType = false;
    for (const prefix of TEXT_CONTENT_TYPES) {
      if (normalisedType.startsWith(prefix)) {
        isTextContentType = true;
        break;
      }
    }

    // Check suffixes (e.g., application/hal+json)
    if (!isTextContentType) {
      for (const suffix of TEXT_SUFFIXES) {
        if (normalisedType.endsWith(suffix)) {
          isTextContentType = true;
          break;
        }
      }
    }

    if (isTextContentType) {
      // Content-type says text, but verify with byte scan as safety net.
      // Handles compressed bodies still in the DB, mislabelled content types, etc.
      const scanResult = scanForBinaryContent(body);
      return scanResult.isBinary
        ? { isBinary: true, reason: "content-scan" }
        : { isBinary: false, reason: "text-content-type" };
    }

    // Check binary content types
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (normalisedType.startsWith(prefix)) {
        return { isBinary: true, reason: "content-type" };
      }
    }
  }

  // Fall back to byte scanning
  return scanForBinaryContent(body);
}

/**
 * Scan buffer for binary content by checking for non-printable characters.
 * Scans first 8KB and considers binary if >10% are non-printable.
 */
function scanForBinaryContent(body: Buffer): BinaryCheckResult {
  const SCAN_SIZE = 8 * 1024; // 8KB
  const BINARY_THRESHOLD = 0.1; // 10%

  const bytesToScan = Math.min(body.length, SCAN_SIZE);
  let nonPrintableCount = 0;

  for (let i = 0; i < bytesToScan; i++) {
    const byte = body[i];
    if (byte === undefined) continue;

    // Allow common text characters:
    // - Tab (9), LF (10), CR (13)
    // - Printable ASCII (32-126)
    // - Extended ASCII (128-255) for UTF-8
    const isPrintable =
      byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128;

    if (!isPrintable) {
      nonPrintableCount++;
    }
  }

  const ratio = nonPrintableCount / bytesToScan;
  return {
    isBinary: ratio > BINARY_THRESHOLD,
    reason: "content-scan",
  };
}

/**
 * Get a human-readable description for a binary content type.
 */
export function getBinaryTypeDescription(contentType: string | undefined): string {
  if (!contentType) {
    return "Binary";
  }

  const normalisedType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  // Check exact matches first
  if (BINARY_DESCRIPTIONS[normalisedType]) {
    return BINARY_DESCRIPTIONS[normalisedType];
  }

  // Check prefix matches
  for (const [prefix, description] of Object.entries(BINARY_DESCRIPTIONS)) {
    if (prefix.endsWith("/") && normalisedType.startsWith(prefix)) {
      return description;
    }
  }

  // Extract subtype for better description
  if (normalisedType.startsWith("application/")) {
    const subtype = normalisedType.replace("application/", "");
    // Capitalise first letter
    return subtype.charAt(0).toUpperCase() + subtype.slice(1);
  }

  return "Binary";
}
