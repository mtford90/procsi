/**
 * Full-screen info overlay showing proxy connection details.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { buildProxyInfo } from "../../../shared/proxy-info.js";

export interface InfoModalProps {
  proxyPort: number | undefined;
  caCertPath: string;
  width: number;
  height: number;
  onClose: () => void;
  isActive?: boolean;
}

const KEY_COLUMN_WIDTH = 24;

export function InfoModal({
  proxyPort,
  caCertPath,
  width,
  height,
  onClose,
  isActive = true,
}: InfoModalProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (input === "i" || key.escape) {
        onClose();
      }
    },
    { isActive },
  );

  if (proxyPort === undefined) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        alignItems="center"
        justifyContent="center"
      >
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Proxy Connection Details
          </Text>
        </Box>

        <Text color="yellow">Proxy is not running</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Run{" "}
            <Text color="cyan">eval $(htpx intercept)</Text>
            {" "}to start the proxy
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Press i or Escape to close</Text>
        </Box>
      </Box>
    );
  }

  const info = buildProxyInfo(proxyPort, caCertPath);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      alignItems="center"
      justifyContent="center"
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Proxy Connection Details
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Box width={KEY_COLUMN_WIDTH}>
            <Text bold>Proxy URL:</Text>
          </Box>
          <Text color="green">{info.proxyUrl}</Text>
        </Box>
        <Box>
          <Box width={KEY_COLUMN_WIDTH}>
            <Text bold>CA certificate:</Text>
          </Box>
          <Text color="green">{info.caCertPath}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={0}>
          <Text bold color="yellow">
            Environment variables
          </Text>
        </Box>
        {info.envBlock.split("\n").map((line) => (
          <Text key={line} dimColor>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press i or Escape to close</Text>
      </Box>
    </Box>
  );
}
