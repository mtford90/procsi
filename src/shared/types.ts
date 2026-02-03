/**
 * Core types for htpx
 */

export interface CapturedRequest {
  id: string;
  sessionId: string;
  label?: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody?: Buffer;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: Buffer;
  durationMs?: number;
}

export interface Session {
  id: string;
  label?: string;
  pid: number;
  startedAt: number;
}

export interface DaemonStatus {
  running: boolean;
  proxyPort?: number;
  sessionCount: number;
  requestCount: number;
  version: string;
}
