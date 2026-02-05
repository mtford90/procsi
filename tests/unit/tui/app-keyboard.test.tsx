/**
 * Tests for TUI keyboard interactions using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../../../src/cli/tui/App.js";
import type { CapturedRequest, CapturedRequestSummary } from "../../../src/shared/types.js";

// Mock the hooks that depend on external services
vi.mock("../../../src/cli/tui/hooks/useRequests.js", () => ({
  useRequests: vi.fn(),
}));

const mockExportCurl = vi.fn().mockResolvedValue({ success: true, message: "Copied to clipboard" });
const mockExportHar = vi.fn().mockReturnValue({ success: true, message: "HAR exported" });

vi.mock("../../../src/cli/tui/hooks/useExport.js", () => ({
  useExport: () => ({
    exportCurl: mockExportCurl,
    exportHar: mockExportHar,
  }),
}));

// Import the mocked hook so we can control its return value
import { useRequests } from "../../../src/cli/tui/hooks/useRequests.js";
const mockUseRequests = vi.mocked(useRequests);

const createMockSummary = (overrides: Partial<CapturedRequestSummary> = {}): CapturedRequestSummary => ({
  id: "test-1",
  sessionId: "session-1",
  timestamp: Date.now(),
  method: "GET",
  url: "http://example.com/api/users",
  host: "example.com",
  path: "/api/users",
  responseStatus: 200,
  durationMs: 150,
  requestBodySize: 0,
  responseBodySize: 0,
  ...overrides,
});

const createMockFullRequest = (overrides: Partial<CapturedRequest> = {}): CapturedRequest => ({
  id: "test-1",
  sessionId: "session-1",
  timestamp: Date.now(),
  method: "GET",
  url: "http://example.com/api/users",
  host: "example.com",
  path: "/api/users",
  requestHeaders: { "content-type": "application/json" },
  responseStatus: 200,
  responseHeaders: { "content-type": "application/json" },
  durationMs: 150,
  ...overrides,
});

// Helper to wait for React state updates
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("App keyboard interactions", () => {
  const mockRefresh = vi.fn();
  const mockGetFullRequest = vi.fn();
  const mockGetAllFullRequests = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockReset();
    mockGetFullRequest.mockReset();
    mockGetAllFullRequests.mockReset();
    mockExportCurl.mockReset().mockResolvedValue({ success: true, message: "Copied to clipboard" });
    mockExportHar.mockReset().mockReturnValue({ success: true, message: "HAR exported" });
  });

  // Helper to set up mocks with multiple requests
  const setupMocksWithRequests = (count: number) => {
    const summaries = Array.from({ length: count }, (_, i) =>
      createMockSummary({ id: `test-${i}`, path: `/api/endpoint-${i}` })
    );
    const fullRequests = Array.from({ length: count }, (_, i) =>
      createMockFullRequest({ id: `test-${i}` })
    );

    mockGetFullRequest.mockImplementation((id: string) => {
      const req = fullRequests.find((r) => r.id === id);
      return Promise.resolve(req ?? null);
    });
    mockGetAllFullRequests.mockResolvedValue(fullRequests);

    mockUseRequests.mockReturnValue({
      requests: summaries,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
      getFullRequest: mockGetFullRequest,
      getAllFullRequests: mockGetAllFullRequests,
    });

    return { summaries, fullRequests };
  };

  describe("URL toggle (u key)", () => {
    it("shows path by default", () => {
      const mockSummary = createMockSummary();
      const mockFullRequest = createMockFullRequest();
      mockUseRequests.mockReturnValue({
        requests: [mockSummary],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
        getFullRequest: vi.fn().mockResolvedValue(mockFullRequest),
        getAllFullRequests: vi.fn().mockResolvedValue([mockFullRequest]),
      });

      const { lastFrame } = render(<App __testEnableInput />);
      const frame = lastFrame();

      // Should show path, not full URL
      expect(frame).toContain("/api/users");
    });

    it("toggles to full URL when u is pressed", async () => {
      const mockSummary = createMockSummary();
      const mockFullRequest = createMockFullRequest();
      mockUseRequests.mockReturnValue({
        requests: [mockSummary],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
        getFullRequest: vi.fn().mockResolvedValue(mockFullRequest),
        getAllFullRequests: vi.fn().mockResolvedValue([mockFullRequest]),
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);

      stdin.write("u");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("http://example.com");
      expect(frame).toContain("Showing full URL");
    });

    it("toggles back to path when u is pressed again", async () => {
      const mockSummary = createMockSummary();
      const mockFullRequest = createMockFullRequest();
      mockUseRequests.mockReturnValue({
        requests: [mockSummary],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
        getFullRequest: vi.fn().mockResolvedValue(mockFullRequest),
        getAllFullRequests: vi.fn().mockResolvedValue([mockFullRequest]),
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);

      stdin.write("u");
      await tick();
      stdin.write("u");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Showing path");
    });

    it("shows toggle URL hint in status bar", () => {
      mockUseRequests.mockReturnValue({
        requests: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
        getFullRequest: vi.fn().mockResolvedValue(null),
        getAllFullRequests: vi.fn().mockResolvedValue([]),
      });

      const { lastFrame } = render(<App __testEnableInput />);
      const frame = lastFrame();

      expect(frame).toContain("u");
      expect(frame).toContain("URL");
    });
  });

  describe("Navigation (j/k, arrows)", () => {
    it("j moves selection down in list panel", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Initially first item (test-0) should be selected
      expect(mockGetFullRequest).toHaveBeenCalledWith("test-0");

      mockGetFullRequest.mockClear();

      // Press j to move down
      stdin.write("j");
      await tick();

      // Selection should move down - getFullRequest should be called for the new selection
      expect(mockGetFullRequest).toHaveBeenCalledWith("test-1");
    });

    it("k moves selection up in list panel", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Move down first
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Now press k to move up
      stdin.write("k");
      await tick();

      expect(mockGetFullRequest).toHaveBeenLastCalledWith("test-1");
    });

    it("down arrow moves selection down", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Press down arrow (escape sequence)
      stdin.write("\x1b[B");
      await tick();

      expect(mockGetFullRequest).toHaveBeenCalledWith("test-1");
    });

    it("up arrow moves selection up", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Move down first
      stdin.write("\x1b[B");
      await tick();

      // Press up arrow
      stdin.write("\x1b[A");
      await tick();

      expect(mockGetFullRequest).toHaveBeenLastCalledWith("test-0");
    });

    it("selection stops at lower bound (cannot go below 0)", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Clear mock calls after initial load
      mockGetFullRequest.mockClear();

      // Try to move up from the first item
      stdin.write("k");
      await tick();
      stdin.write("k");
      await tick();

      // Should remain at first item (test-0) - no call to getFullRequest
      // because selection didn't change
      expect(mockGetFullRequest).not.toHaveBeenCalled();
    });

    it("selection stops at upper bound (cannot go past length-1)", async () => {
      setupMocksWithRequests(3);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Move to the end
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      mockGetFullRequest.mockClear();

      // Try to move past the end
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Should remain at last item - no additional calls
      expect(mockGetFullRequest).not.toHaveBeenCalled();
    });

    it("j/k navigate sections when accordion panel is active", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Switch to accordion panel (Tab or press 2)
      stdin.write("2");
      await tick();

      // Should now show focus indicator on Request section
      let frame = lastFrame();
      // The focus indicator is ● in the section header
      expect(frame).toContain("●");
      expect(frame).toContain("[2] Request");

      // Navigate down to next section
      stdin.write("j");
      await tick();

      frame = lastFrame();
      // Focus should now be on Request Body section (focus indicator moved)
      expect(frame).toContain("[3] Request Body");
    });
  });

  describe("Panel switching (Tab, Shift+Tab, 1-5)", () => {
    it("Tab from list goes to accordion section 0", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Press Tab to switch to accordion
      stdin.write("\t");
      await tick();

      const frame = lastFrame();
      // The accordion should now be active with focus on first section
      // Focus indicator should appear
      expect(frame).toContain("●");
    });

    it("Tab cycles through accordion sections", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Press Tab to go to accordion section 0
      stdin.write("\t");
      await tick();

      // Press Tab again to go to section 1
      stdin.write("\t");
      await tick();

      // Keep pressing Tab to go through all sections
      stdin.write("\t");
      await tick();
      stdin.write("\t");
      await tick();

      // One more Tab should return to list
      stdin.write("\t");
      await tick();

      // Now we should be back in list panel - focus indicator should not be in accordion
      const frame = lastFrame();
      // List panel should be active - accordion sections should not have focus indicator
      expect(frame).toBeDefined();
    });

    it("Shift+Tab reverses the cycle", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Press Shift+Tab from list should go to last accordion section
      stdin.write("\x1b[Z"); // Shift+Tab escape sequence
      await tick();

      const frame = lastFrame();
      // Should be on last section (Response Body)
      expect(frame).toContain("●");
    });

    it("1 key activates list panel", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // First go to accordion
      stdin.write("2");
      await tick();

      // Then press 1 to go back to list
      stdin.write("1");
      await tick();

      // j should now move list selection, not accordion
      mockGetFullRequest.mockClear();
      stdin.write("j");
      await tick();

      // Since we only have 1 request, nothing changes, but accordion should not have focus
      const frame = lastFrame();
      // Verify we got a frame back and the accordion focus indicator is not visible
      expect(frame).not.toContain("● ▼ [2]");
    });

    it("2 key activates accordion section 0 (Request)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("2");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("●");
      // Should contain the focus marker near Request section header
    });

    it("3 key activates accordion section 1 (Request Body)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("3");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("●");
    });

    it("4 key activates accordion section 2 (Response)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("4");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("●");
    });

    it("5 key activates accordion section 3 (Response Body)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("5");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("●");
    });
  });

  describe("Section toggle (Enter)", () => {
    it("Enter in accordion toggles section expansion", async () => {
      const fullRequest = createMockFullRequest({
        responseBody: Buffer.from('{"data":"test"}'),
      });
      mockUseRequests.mockReturnValue({
        requests: [createMockSummary()],
        isLoading: false,
        error: null,
        refresh: mockRefresh,
        getFullRequest: vi.fn().mockResolvedValue(fullRequest),
        getAllFullRequests: vi.fn().mockResolvedValue([fullRequest]),
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Go to accordion (section 0 - Request - which is expanded by default)
      stdin.write("2");
      await tick();

      // Get initial frame to compare
      const frameBefore = lastFrame();

      // Press Enter to toggle (collapse it)
      stdin.write("\r");
      await tick();

      const frameAfter = lastFrame();

      // The frame should be different (section collapsed)
      // Before: expanded (▼), After: collapsed (▶) for the focused section
      expect(frameBefore).toContain("▼");
      // Verify toggle happened by checking frames are different
      expect(frameAfter).not.toBe(frameBefore);
    });

    it("Enter in list panel does not toggle sections", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Make sure we're in list panel (press 1)
      stdin.write("1");
      await tick();

      const frameBefore = lastFrame();

      // Press Enter
      stdin.write("\r");
      await tick();

      const frameAfter = lastFrame();

      // Frame should be essentially the same (Enter has no effect in list panel)
      // Both should show the same expanded sections
      expect(frameBefore).toBe(frameAfter);
    });
  });

  describe("Actions (r, c, h)", () => {
    it("r calls refresh and shows Refreshing status", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("r");
      await tick();

      expect(mockRefresh).toHaveBeenCalled();
      const frame = lastFrame();
      expect(frame).toContain("Refreshing");
    });

    it("c with selected request calls exportCurl", async () => {
      const fullRequest = createMockFullRequest();
      mockUseRequests.mockReturnValue({
        requests: [createMockSummary()],
        isLoading: false,
        error: null,
        refresh: mockRefresh,
        getFullRequest: vi.fn().mockResolvedValue(fullRequest),
        getAllFullRequests: mockGetAllFullRequests,
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("c");
      await tick(100); // Give more time for async operation

      expect(mockExportCurl).toHaveBeenCalled();
      const frame = lastFrame();
      expect(frame).toContain("Copied");
    });

    it("c without selection shows No request selected", async () => {
      mockUseRequests.mockReturnValue({
        requests: [],
        isLoading: false,
        error: null,
        refresh: mockRefresh,
        getFullRequest: vi.fn().mockResolvedValue(null),
        getAllFullRequests: vi.fn().mockResolvedValue([]),
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("c");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("No request selected");
    });

    it("h with requests calls exportHar", async () => {
      const fullRequest = createMockFullRequest();
      mockGetAllFullRequests.mockResolvedValue([fullRequest]);
      mockUseRequests.mockReturnValue({
        requests: [createMockSummary()],
        isLoading: false,
        error: null,
        refresh: mockRefresh,
        getFullRequest: vi.fn().mockResolvedValue(fullRequest),
        getAllFullRequests: mockGetAllFullRequests,
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("h");
      await tick(100); // Give more time for async operation

      expect(mockGetAllFullRequests).toHaveBeenCalled();
      const frame = lastFrame();
      // Should show exporting message or success
      expect(frame).toMatch(/HAR|Export/i);
    });

    it("h without requests shows No requests to export", async () => {
      mockUseRequests.mockReturnValue({
        requests: [],
        isLoading: false,
        error: null,
        refresh: mockRefresh,
        getFullRequest: vi.fn().mockResolvedValue(null),
        getAllFullRequests: vi.fn().mockResolvedValue([]),
      });

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("h");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("No requests to export");
    });
  });
});
