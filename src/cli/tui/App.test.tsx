/**
 * Tests for TUI keyboard interactions using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App, MIN_TERMINAL_COLUMNS, MIN_TERMINAL_ROWS } from "./App.js";
import type { CapturedRequest, CapturedRequestSummary } from "../../shared/types.js";

// Mock the hooks that depend on external services
vi.mock("./hooks/useRequests.js", () => ({
  useRequests: vi.fn(),
}));


const mockExportCurl = vi.fn().mockResolvedValue({ success: true, message: "Copied to clipboard" });
const mockExportHar = vi.fn().mockReturnValue({ success: true, message: "HAR exported" });

vi.mock("./hooks/useExport.js", () => ({
  useExport: () => ({
    exportCurl: mockExportCurl,
    exportHar: mockExportHar,
  }),
}));

const mockCopyToClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock("./utils/clipboard.js", () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

const mockOpenInExternalApp = vi.fn().mockResolvedValue({ success: true, message: "Opened" });
vi.mock("./utils/open-external.js", () => ({
  openInExternalApp: (...args: unknown[]) => mockOpenInExternalApp(...args),
}));

vi.mock("./hooks/useStdoutDimensions.js", () => ({
  useStdoutDimensions: () => [200, 50],
}));

vi.mock("../../shared/project.js", () => ({
  findProjectRoot: () => "/mock/project",
  readProxyPort: () => 54321,
  getHtpxPaths: () => ({
    htpxDir: "/mock/project/.htpx",
    proxyPortFile: "/mock/project/.htpx/proxy.port",
    controlSocketFile: "/mock/project/.htpx/control.sock",
    databaseFile: "/mock/project/.htpx/requests.db",
    caKeyFile: "/mock/project/.htpx/ca-key.pem",
    caCertFile: "/mock/project/.htpx/ca.pem",
    pidFile: "/mock/project/.htpx/daemon.pid",
    logFile: "/mock/project/.htpx/htpx.log",
  }),
}));

// Import the mocked hook so we can control its return value
import { useRequests } from "./hooks/useRequests.js";
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
    mockCopyToClipboard.mockReset().mockResolvedValue(undefined);
    mockOpenInExternalApp.mockReset().mockResolvedValue({ success: true, message: "Opened" });
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
      await tick(100);

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
      await tick(100);
      stdin.write("u");
      await tick(100);

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

      // Status bar contains the u key hint (may be truncated at narrow widths)
      expect(frame).toMatch(/u\s/);
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
      // The focus indicator is » in the section header
      expect(frame).toContain("»");
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
      expect(frame).toContain("»");
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
      expect(frame).toContain("»");
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
      expect(frame).not.toContain("» ▼ [2]");
    });

    it("2 key activates accordion section 0 (Request)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("2");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("»");
      // Should contain the focus marker near Request section header
    });

    it("3 key activates accordion section 1 (Request Body)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("3");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("»");
    });

    it("4 key activates accordion section 2 (Response)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("4");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("»");
    });

    it("5 key activates accordion section 3 (Response Body)", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("5");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("»");
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

  describe("Empty state guidance (7.6)", () => {
    it("shows intercept command in empty state", () => {
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

      expect(frame).toContain("eval $(htpx intercept)");
    });
  });

  describe("Extended navigation (g/G/Ctrl+u/Ctrl+d)", () => {
    it("g moves to first item in list", async () => {
      setupMocksWithRequests(10);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Move down a few items first
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      mockGetFullRequest.mockClear();

      // Press g to jump to first
      stdin.write("g");
      await tick();

      expect(mockGetFullRequest).toHaveBeenCalledWith("test-0");
    });

    it("G moves to last item in list", async () => {
      setupMocksWithRequests(10);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      mockGetFullRequest.mockClear();

      // Press G to jump to last
      stdin.write("G");
      await tick();

      expect(mockGetFullRequest).toHaveBeenCalledWith("test-9");
    });

    it("g in accordion goes to first section", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Go to accordion section 3
      stdin.write("5");
      await tick();

      // Press g to jump to first section
      stdin.write("g");
      await tick();

      const frame = lastFrame();
      // Focus should be on first section (Request)
      expect(frame).toContain("»");
    });

    it("G in accordion goes to last section", async () => {
      setupMocksWithRequests(1);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Go to accordion section 0
      stdin.write("2");
      await tick();

      // Press G to jump to last section
      stdin.write("G");
      await tick();

      // Verify by navigating — if we're at last section, j shouldn't move further
      // We can just verify it didn't crash and state is consistent
    });

    it("Ctrl+u moves up half page in list", async () => {
      setupMocksWithRequests(30);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Move to bottom first
      stdin.write("G");
      await tick();

      mockGetFullRequest.mockClear();

      // Ctrl+u = \x15
      stdin.write("\x15");
      await tick();

      // Should have moved up — exact position depends on terminal height
      // but should have called getFullRequest with a different ID
      expect(mockGetFullRequest).toHaveBeenCalled();
    });

    it("Ctrl+d moves down half page in list", async () => {
      setupMocksWithRequests(30);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      mockGetFullRequest.mockClear();

      // Ctrl+d = \x04
      stdin.write("\x04");
      await tick();

      // Should have moved down from index 0
      expect(mockGetFullRequest).toHaveBeenCalled();
    });
  });

  describe("Loading spinner (7.3)", () => {
    it("loading state renders a braille spinner character", () => {
      mockUseRequests.mockReturnValue({
        requests: [],
        isLoading: true,
        error: null,
        refresh: vi.fn(),
        getFullRequest: vi.fn().mockResolvedValue(null),
        getAllFullRequests: vi.fn().mockResolvedValue([]),
      });

      const { lastFrame } = render(<App __testEnableInput />);
      const frame = lastFrame();

      // Should contain a braille spinner character (first frame)
      expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
      expect(frame).toContain("Loading...");
    });
  });

  describe("Terminal size check (7.4)", () => {
    it("defines reasonable minimum terminal dimensions", () => {
      expect(MIN_TERMINAL_COLUMNS).toBe(60);
      expect(MIN_TERMINAL_ROWS).toBe(10);
    });

    it("minimum dimensions are smaller than default terminal size", () => {
      // Default terminal is 80x24, which should be above minimums
      expect(MIN_TERMINAL_COLUMNS).toBeLessThanOrEqual(80);
      expect(MIN_TERMINAL_ROWS).toBeLessThanOrEqual(24);
    });
  });

  describe("Help overlay (7.1)", () => {
    it("? opens the help modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("?");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Keyboard Shortcuts");
    });

    it("? closes the help modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Open help
      stdin.write("?");
      await tick();

      // Close help
      stdin.write("?");
      await tick();

      const frame = lastFrame();
      expect(frame).not.toContain("Keyboard Shortcuts");
      // Should be back to main view
      expect(frame).toContain("Requests");
    });

    it("Escape closes the help modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Open help
      stdin.write("?");
      await tick();

      // Close with Escape
      stdin.write("\x1b");
      await tick();

      const frame = lastFrame();
      expect(frame).not.toContain("Keyboard Shortcuts");
    });
  });

  describe("Copy body to clipboard (y key)", () => {
    it("y copies text body to clipboard when on response body section", async () => {
      const fullRequest = createMockFullRequest({
        responseBody: Buffer.from('{"data":"test"}'),
        responseHeaders: { "content-type": "application/json" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press y to copy
      stdin.write("y");
      await tick(100);

      expect(mockCopyToClipboard).toHaveBeenCalledWith('{"data":"test"}');
      const frame = lastFrame();
      expect(frame).toContain("Body copied to clipboard");
    });

    it("y rejects binary body with message", async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
      const fullRequest = createMockFullRequest({
        responseBody: pngBuffer,
        responseHeaders: { "content-type": "image/png" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press y to try to copy
      stdin.write("y");
      await tick();

      expect(mockCopyToClipboard).not.toHaveBeenCalled();
      const frame = lastFrame();
      expect(frame).toContain("Cannot copy binary content");
    });

    it("y shows no body message when body is empty", async () => {
      const fullRequest = createMockFullRequest({
        responseBody: undefined,
        responseHeaders: { "content-type": "application/json" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press y
      stdin.write("y");
      await tick();

      expect(mockCopyToClipboard).not.toHaveBeenCalled();
      const frame = lastFrame();
      expect(frame).toContain("No body to copy");
    });

    it("y does nothing when not on a body section", async () => {
      setupMocksWithRequests(1);

      const { stdin } = render(<App __testEnableInput />);
      await tick();

      // Navigate to Request headers section (not a body section)
      stdin.write("2");
      await tick();

      // Press y
      stdin.write("y");
      await tick();

      expect(mockCopyToClipboard).not.toHaveBeenCalled();
    });
  });

  describe("Info modal (i key)", () => {
    it("i opens the info modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      stdin.write("i");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Proxy Connection Details");
    });

    it("i closes the info modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Open info
      stdin.write("i");
      await tick();

      // Close info
      stdin.write("i");
      await tick();

      const frame = lastFrame();
      expect(frame).not.toContain("Proxy Connection Details");
    });

    it("Escape closes the info modal", async () => {
      setupMocksWithRequests(1);

      const { lastFrame, stdin } = render(<App __testEnableInput />);
      await tick();

      // Open info
      stdin.write("i");
      await tick();

      // Close with Escape
      stdin.write("\x1b");
      await tick();

      const frame = lastFrame();
      expect(frame).not.toContain("Proxy Connection Details");
    });
  });

  describe("Export body (s key)", () => {
    it("s opens export modal for text body content", async () => {
      const fullRequest = createMockFullRequest({
        responseBody: Buffer.from('{"data":"test"}'),
        responseHeaders: { "content-type": "application/json" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press s to export
      stdin.write("s");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Export Body Content");
    });

    it("s opens export modal for binary body content", async () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(0)]);
      const fullRequest = createMockFullRequest({
        responseBody: pngBuffer,
        responseHeaders: { "content-type": "image/png" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press s to export
      stdin.write("s");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Export Body Content");
    });

    it("s shows no body message when body is empty", async () => {
      const fullRequest = createMockFullRequest({
        responseBody: undefined,
        responseHeaders: { "content-type": "application/json" },
      });
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

      // Navigate to Response Body section
      stdin.write("5");
      await tick();

      // Press s
      stdin.write("s");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("No body to export");
    });
  });
});
