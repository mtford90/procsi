export interface ProxyInfo {
  proxyUrl: string;
  caCertPath: string;
  envBlock: string;
}

/**
 * Build proxy connection details from port and CA cert path.
 */
export function buildProxyInfo(proxyPort: number, caCertPath: string): ProxyInfo {
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  const envBlock = [
    `export HTTP_PROXY="${proxyUrl}"`,
    `export HTTPS_PROXY="${proxyUrl}"`,
    `export SSL_CERT_FILE="${caCertPath}"`,
    `export REQUESTS_CA_BUNDLE="${caCertPath}"`,
    `export CURL_CA_BUNDLE="${caCertPath}"`,
    `export NODE_EXTRA_CA_CERTS="${caCertPath}"`,
    `export DENO_CERT="${caCertPath}"`,
    `export CARGO_HTTP_CAINFO="${caCertPath}"`,
    `export GIT_SSL_CAINFO="${caCertPath}"`,
    `export AWS_CA_BUNDLE="${caCertPath}"`,
  ].join("\n");

  return { proxyUrl, caCertPath, envBlock };
}
