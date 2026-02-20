/**
 * Hook for exporting captured requests to various formats.
 */

import { useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CapturedRequest } from "../../../shared/types.js";
import { generateCurl } from "../utils/curl.js";
import { generateFetch } from "../utils/fetch.js";
import { generatePythonRequests } from "../utils/python-requests.js";
import { generateHttpie } from "../utils/httpie.js";
import { generateHarString } from "../utils/har.js";
import { copyToClipboard } from "../utils/clipboard.js";

export type ExportFormat = "curl" | "fetch" | "python" | "httpie";

export interface ExportResult {
  success: boolean;
  message: string;
}

interface UseExportResult {
  exportFormat: (request: CapturedRequest, format: ExportFormat) => Promise<ExportResult>;
  exportHar: (requests: CapturedRequest[], filename?: string) => ExportResult;
}

/** Maps each format to its generator function. */
const FORMAT_GENERATORS: Record<ExportFormat, (request: CapturedRequest) => string> = {
  curl: generateCurl,
  fetch: generateFetch,
  python: generatePythonRequests,
  httpie: generateHttpie,
};

/** Human-readable labels for status messages. */
export const FORMAT_LABELS: Record<ExportFormat, string> = {
  curl: "cURL",
  fetch: "Fetch",
  python: "Python",
  httpie: "HTTPie",
};

/**
 * Generate an export string for a request in the given format and copy to clipboard.
 * Extracted as standalone function for testability.
 */
export async function exportFormatToClipboard(
  request: CapturedRequest,
  format: ExportFormat
): Promise<ExportResult> {
  try {
    const generator = FORMAT_GENERATORS[format];
    const output = generator(request);
    await copyToClipboard(output);
    return {
      success: true,
      message: `${FORMAT_LABELS[format]} copied to clipboard`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : `Failed to copy ${FORMAT_LABELS[format]}`,
    };
  }
}

/**
 * Generate curl command for a request and copy to clipboard.
 * Kept for backwards compatibility with existing tests.
 */
export async function exportCurlToClipboard(request: CapturedRequest): Promise<ExportResult> {
  return exportFormatToClipboard(request, "curl");
}

/**
 * Export requests to HAR file.
 * Extracted as standalone function for testability.
 */
export function exportHarToFile(requests: CapturedRequest[], filename?: string): ExportResult {
  try {
    const harFilename = filename ?? `procsi-export-${Date.now()}.har`;
    const harPath = path.resolve(process.cwd(), harFilename);
    const harContent = generateHarString(requests);

    fs.writeFileSync(harPath, harContent, "utf-8");

    return {
      success: true,
      message: `Exported ${requests.length} request(s) to ${harPath}`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to export HAR",
    };
  }
}

/**
 * Hook providing export functionality for captured requests.
 * Wraps standalone functions with useCallback for React optimisation.
 */
export function useExport(): UseExportResult {
  const exportFormatFn = useCallback(
    (request: CapturedRequest, format: ExportFormat) => exportFormatToClipboard(request, format),
    []
  );

  const exportHar = useCallback(
    (requests: CapturedRequest[], filename?: string) => exportHarToFile(requests, filename),
    []
  );

  return {
    exportFormat: exportFormatFn,
    exportHar,
  };
}
