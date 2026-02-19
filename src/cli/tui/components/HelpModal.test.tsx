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
    width: 80,
    height: 60,
    onClose: vi.fn(),
    isActive: true,
  };

  it("renders the title", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    expect(lastFrame()).toContain("Keyboard Shortcuts");
  });

  it("renders the Navigation section", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("Navigation");
    expect(frame).toContain("Move down");
    expect(frame).toContain("Move up");
    expect(frame).toContain("Half page up / down");
    expect(frame).toContain("Full page down / up");
    expect(frame).toContain("Jump to section");
  });

  it("renders the Actions section", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("Actions");
    expect(frame).toContain("View body content");
    expect(frame).toContain("Copy as cURL");
    expect(frame).toContain("Export HAR");
    expect(frame).toContain("Copy body to clipboard");
    expect(frame).toContain("Export body content");
    expect(frame).toContain("Toggle full URL");
    expect(frame).toContain("body:req:error");
    expect(frame).toContain("Refresh");
  });

  it("renders the JSON Explorer section", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("JSON Explorer");
    expect(frame).toContain("Navigate tree");
    expect(frame).toContain("Half page up / down");
    expect(frame).toContain("Full page down / up");
    expect(frame).toContain("Toggle node");
    expect(frame).toContain("Collapse node");
    expect(frame).toContain("Expand / collapse all");
    expect(frame).toContain("Filter by path");
    expect(frame).toContain("Next / previous match");
    expect(frame).toContain("Copy value");
    expect(frame).toContain("Close explorer");
  });

  it("renders the Text Viewer section", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("Text Viewer");
    expect(frame).toContain("Scroll line by line");
    expect(frame).toContain("Scroll half page");
    expect(frame).toContain("Full page down / up");
    expect(frame).toContain("Page down");
    expect(frame).toContain("Search text");
    expect(frame).toContain("Next / previous match");
    expect(frame).toContain("Close viewer");
  });

  it("renders the General section", () => {
    const { lastFrame } = render(<HelpModal {...defaultProps} />);
    const frame = lastFrame();

    expect(frame).toContain("General");
    expect(frame).toContain("Toggle help");
    expect(frame).toContain("Quit");
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
});
