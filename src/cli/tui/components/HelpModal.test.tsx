/**
 * Tests for the HelpModal component.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { HelpModal } from "./HelpModal.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("HelpModal", () => {
  const defaultProps = {
    width: 120,
    height: 80,
    onClose: vi.fn(),
    isActive: true,
  };

  it("renders the title", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    expect(lastFrame()).toContain("Keyboard Shortcuts");
  });

  it("renders navigation shortcuts", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("Navigation");
    expect(frame).toContain("Move down");
    expect(frame).toContain("Move up");
    expect(frame).toContain("Half page up / down");
    expect(frame).toContain("Jump to section");
  });

  it("renders action shortcuts", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("Actions");
    expect(frame).toContain("View body content");
    expect(frame).toContain("Export: cURL / Fetch / Python / HTTPie / HAR");
    expect(frame).toContain("Replay request");
    expect(frame).toContain("Toggle full URL");
    expect(frame).toContain("Refresh");
    expect(frame).toContain("Toggle help");
    expect(frame).toContain("Quit");
    expect(frame).toContain("Interceptor events");
  });

  it("renders close instructions", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    expect(lastFrame()).toContain("Press ? or Escape to close");
  });

  it("calls onClose when ? is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<HelpModal {...defaultProps} onClose={onClose} />);

    stdin.write("?");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const { stdin } = render(<HelpModal {...defaultProps} onClose={onClose} />);

    stdin.write("\x1b");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  describe("Connection Info section", () => {
    it("shows proxy URL when proxyPort is defined", () => {
      const { lastFrame } = render(
        <HelpModal {...defaultProps} proxyPort={54321} caCertPath="/path/to/.procsi/ca.pem" />,
      );
      const frame = lastFrame();
      expect(frame).toContain("Connection Info");
      expect(frame).toContain("http://127.0.0.1:54321");
    });

    it("shows CA cert path when proxyPort is defined", () => {
      const { lastFrame } = render(
        <HelpModal {...defaultProps} proxyPort={54321} caCertPath="/path/to/.procsi/ca.pem" />,
      );
      expect(lastFrame()).toContain("/path/to/.procsi/ca.pem");
    });

    it("shows not-running state when proxyPort is undefined", () => {
      const { lastFrame } = render(<HelpModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("Connection Info");
      expect(frame).toContain("Proxy is not running");
    });

    it("does not show proxy URL in not-running state", () => {
      const { lastFrame } = render(<HelpModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).not.toContain("http://127.0.0.1");
    });
  });
});
