/**
 * Tests for InfoBar session statistics and error alerts.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InfoBar } from "./InfoBar.js";

const tick = (ms = 50): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("InfoBar component", () => {
  describe("error mode", () => {
    it("shows red warning text with error count when interceptorErrorCount > 0", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={3}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("3");
      expect(frame).toContain("interceptor");
    });

    it("mentions 'L to view' when errors are present", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={2}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("L to view");
    });

    it("uses singular 'error' for count of 1", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={1}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("1 interceptor error");
      expect(frame).not.toContain("errors");
    });

    it("uses plural 'errors' for count > 1", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={5}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("5 interceptor errors");
      expect(frame).not.toMatch(/5 interceptor error[^s]/);
    });
  });

  describe("info mode", () => {
    it("shows request count and interceptor count when no errors", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={3}
          interceptorCount={2}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("3");
      expect(frame).toContain("requests captured");
      expect(frame).toContain("2");
      expect(frame).toContain("interceptors loaded");
    });

    it("uses singular 'request' for count of 1", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={1}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("1 request");
      expect(frame).not.toContain("1 requests");
    });

    it("uses singular 'interceptor' for count of 1", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={1}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      expect(frame).toContain("1 interceptor");
      expect(frame).not.toContain("1 interceptors");
    });
  });

  describe("uptime formatting", () => {
    it("formats uptime correctly for recent start time", async () => {
      // Use a start time that's 5 seconds in the past
      const startTime = Date.now() - 5000;

      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={1}
          interceptorCount={0}
          startTime={startTime}
          width={100}
        />,
      );

      // Wait for the initial effect to run
      await tick(10);

      const frame = lastFrame();

      // Should show approximately 5 seconds (allow for 4-6 to handle timing variations)
      expect(frame).toMatch(/uptime: 00:00:0[4-6]/);
    });

    it("formats uptime correctly for hours and minutes", async () => {
      // 1 hour, 23 minutes, 45 seconds ago
      const startTime = Date.now() - (1 * 3600 * 1000 + 23 * 60 * 1000 + 45 * 1000);

      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={1}
          interceptorCount={0}
          startTime={startTime}
          width={100}
        />,
      );

      // Wait for the initial effect to run
      await tick(10);

      const frame = lastFrame();

      // Should show approximately 1:23:45 (allow for slight variations)
      expect(frame).toMatch(/uptime: 01:23:4[4-6]/);
    });

    it("shows 00:00:00 format for very recent start", async () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={1}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );

      // Wait for the initial effect to run
      await tick(10);

      const frame = lastFrame();

      // Should show 00:00:00 or 00:00:01 depending on timing
      expect(frame).toMatch(/uptime: 00:00:0[01]/);
    });
  });

  describe("empty state", () => {
    it("renders empty box when all counts are 0 and uptime is 0", () => {
      const { lastFrame } = render(
        <InfoBar
          interceptorErrorCount={0}
          interceptorWarnCount={0}
          requestCount={0}
          interceptorCount={0}
          startTime={Date.now()}
          width={100}
        />,
      );
      const frame = lastFrame();

      // Should not contain any text from error or info mode
      expect(frame).not.toContain("error");
      expect(frame).not.toContain("request");
      expect(frame).not.toContain("interceptor");
      expect(frame).not.toContain("uptime");

      // Frame should be minimal (just whitespace/box borders)
      expect(frame.trim().length).toBeLessThan(10);
    });
  });
});
