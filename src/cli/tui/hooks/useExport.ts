/**
 * Hook for exporting captured requests to various formats.
 */

import { useCallback } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CapturedRequest } from "../../../shared/types.js";
import { generateCurl } from "../utils/curl.js";
import { generateHarString } from "../utils/har.js";
import { copyToClipboard } from "../utils/clipboard.js";

export interface ExportResult {
  success: boolean;
  message: string;
}

interface UseExportResult {
  exportCurl: (request: CapturedRequest) => Promise<ExportResult>;
  exportHar: (requests: CapturedRequest[], filename?: string) => ExportResult;
}

/**
 * Generate curl command for a request and copy to clipboard.
 * Extracted as standalone function for testability.
 */
export async function exportCurlToClipboard(request: CapturedRequest): Promise<ExportResult> {
  try {
    const curl = generateCurl(request);
    await copyToClipboard(curl);
    return {
      success: true,
      message: "Copied to clipboard",
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to copy curl",
    };
  }
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
  const exportCurl = useCallback((request: CapturedRequest) => exportCurlToClipboard(request), []);

  const exportHar = useCallback(
    (requests: CapturedRequest[], filename?: string) => exportHarToFile(requests, filename),
    []
  );

  return {
    exportCurl,
    exportHar,
  };
}
