/**
 * Generate HAR (HTTP Archive) format from captured requests.
 */

import type { CapturedRequest } from "../../../shared/types.js";
import { getProcsiVersion } from "../../../shared/version.js";
import { getStatusText } from "./formatters.js";

/**
 * HAR 1.2 specification types.
 */
interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: unknown[];
    headers: { name: string; value: string }[];
    queryString: { name: string; value: string }[];
    postData?: {
      mimeType: string;
      text: string;
    };
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: unknown[];
    headers: { name: string; value: string }[];
    content: {
      size: number;
      mimeType: string;
      text?: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
}

interface Har {
  log: {
    version: string;
    creator: {
      name: string;
      version: string;
    };
    entries: HarEntry[];
  };
}

/**
 * Parse query string from URL.
 */
function parseQueryString(url: string): { name: string; value: string }[] {
  try {
    const parsedUrl = new URL(url);
    const result: { name: string; value: string }[] = [];
    parsedUrl.searchParams.forEach((value, name) => {
      result.push({ name, value });
    });
    return result;
  } catch {
    return [];
  }
}

/**
 * Convert headers object to HAR format.
 */
function headersToHar(
  headers: Record<string, string> | undefined
): { name: string; value: string }[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

/**
 * Get content type from headers.
 */
function getContentType(headers: Record<string, string> | undefined): string {
  if (!headers) {
    return "application/octet-stream";
  }
  const contentType =
    headers["content-type"] || headers["Content-Type"] || "application/octet-stream";
  return contentType;
}

/**
 * Convert a captured request to HAR entry format.
 */
function requestToHarEntry(request: CapturedRequest): HarEntry {
  const requestBodySize = request.requestBody?.length ?? 0;
  const responseBodySize = request.responseBody?.length ?? 0;
  const requestHeadersSize = JSON.stringify(request.requestHeaders).length;
  const responseHeadersSize = JSON.stringify(request.responseHeaders ?? {}).length;

  const entry: HarEntry = {
    startedDateTime: new Date(request.timestamp).toISOString(),
    time: request.durationMs ?? 0,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(request.requestHeaders),
      queryString: parseQueryString(request.url),
      headersSize: requestHeadersSize,
      bodySize: requestBodySize,
    },
    response: {
      status: request.responseStatus ?? 0,
      statusText: getStatusText(request.responseStatus),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(request.responseHeaders),
      content: {
        size: responseBodySize,
        mimeType: getContentType(request.responseHeaders),
      },
      redirectURL: "",
      headersSize: responseHeadersSize,
      bodySize: responseBodySize,
    },
    cache: {},
    timings: {
      send: 0,
      wait: request.durationMs ?? 0,
      receive: 0,
    },
  };

  // Add request body if present
  if (request.requestBody && request.requestBody.length > 0) {
    entry.request.postData = {
      mimeType: getContentType(request.requestHeaders),
      text: request.requestBody.toString("utf-8"),
    };
  }

  // Add response body if present
  if (request.responseBody && request.responseBody.length > 0) {
    entry.response.content.text = request.responseBody.toString("utf-8");
  }

  return entry;
}

/**
 * Generate a HAR object from captured requests.
 */
export function generateHar(requests: CapturedRequest[]): Har {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "procsi",
        version: getProcsiVersion(),
      },
      entries: requests.map(requestToHarEntry),
    },
  };
}

/**
 * Generate HAR JSON string from captured requests.
 */
export function generateHarString(requests: CapturedRequest[]): string {
  return JSON.stringify(generateHar(requests), null, 2);
}
