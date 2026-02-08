import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InfoModal } from "./InfoModal.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InfoModal", () => {
  const defaultProps = {
    proxyPort: 54321 as number | undefined,
    caCertPath: "/path/to/.htpx/ca.pem",
    width: 100,
    height: 40,
    onClose: vi.fn(),
    isActive: true,
  };

  it("renders the title", () => {
    const { lastFrame } = render(<InfoModal {...defaultProps} />);
    expect(lastFrame()).toContain("Proxy Connection Details");
  });

  it("renders the proxy URL", () => {
    const { lastFrame } = render(<InfoModal {...defaultProps} />);
    expect(lastFrame()).toContain("http://127.0.0.1:54321");
  });

  it("renders the CA cert path", () => {
    const { lastFrame } = render(<InfoModal {...defaultProps} />);
    expect(lastFrame()).toContain("/path/to/.htpx/ca.pem");
  });

  it("renders environment variables", () => {
    const { lastFrame } = render(<InfoModal {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("HTTP_PROXY");
    expect(frame).toContain("HTTPS_PROXY");
    expect(frame).toContain("SSL_CERT_FILE");
    expect(frame).toContain("REQUESTS_CA_BUNDLE");
    expect(frame).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("renders close instructions", () => {
    const { lastFrame } = render(<InfoModal {...defaultProps} />);
    expect(lastFrame()).toContain("Press i or Escape to close");
  });

  it("calls onClose when i is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<InfoModal {...defaultProps} onClose={onClose} />);

    stdin.write("i");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<InfoModal {...defaultProps} onClose={onClose} />);

    stdin.write("\x1b");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("shows not-running state when proxyPort is undefined", () => {
    const { lastFrame } = render(
      <InfoModal {...defaultProps} proxyPort={undefined} />
    );
    const frame = lastFrame();
    expect(frame).toContain("Proxy is not running");
    expect(frame).toContain("eval $(htpx intercept)");
  });

  it("does not show proxy URL in not-running state", () => {
    const { lastFrame } = render(
      <InfoModal {...defaultProps} proxyPort={undefined} />
    );
    const frame = lastFrame();
    expect(frame).not.toContain("http://127.0.0.1");
    expect(frame).not.toContain("HTTP_PROXY");
  });
});
