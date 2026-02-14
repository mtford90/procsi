/**
 * Persistent status line showing session stats or interceptor errors.
 * Displays error alert when interceptor errors are present, otherwise shows
 * request count, interceptor count, and session uptime.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

const UPTIME_TICK_MS = 1000;

export interface InfoBarProps {
  interceptorErrorCount: number;
  interceptorWarnCount: number;
  requestCount: number;
  interceptorCount: number;
  startTime: number; // Date.now() at mount, for uptime
  width: number;
}

/**
 * Format seconds as HH:MM:SS.
 */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function InfoBar({
  interceptorErrorCount,
  requestCount,
  interceptorCount,
  startTime,
}: InfoBarProps): React.ReactElement {
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const updateUptime = (): void => {
      setUptime(Math.floor((Date.now() - startTime) / UPTIME_TICK_MS));
    };

    updateUptime();
    const timerId = setInterval(updateUptime, UPTIME_TICK_MS);

    return () => {
      clearInterval(timerId);
    };
  }, [startTime]);

  // Error mode — show warning about interceptor errors
  if (interceptorErrorCount > 0) {
    const errorText = interceptorErrorCount === 1 ? "error" : "errors";
    return (
      <Box height={1} paddingX={1}>
        <Text bold color="red">
          {"\u26A0"} {interceptorErrorCount} interceptor {errorText} {"\u2014"} press L to view
        </Text>
      </Box>
    );
  }

  // Info mode — show session statistics
  if (requestCount > 0 || interceptorCount > 0 || uptime > 0) {
    const requestText = requestCount === 1 ? "request" : "requests";
    const interceptorText = interceptorCount === 1 ? "interceptor" : "interceptors";

    return (
      <Box height={1} paddingX={1}>
        <Text dimColor>
          {requestCount} {requestText} captured {"\u2502"} {interceptorCount} {interceptorText} loaded {"\u2502"} uptime: {formatUptime(uptime)}
        </Text>
      </Box>
    );
  }

  // Nothing to show — render empty box to maintain layout
  return <Box height={1} />;
}
