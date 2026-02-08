import { describe, it, expect } from "vitest";
import { isBinaryContent, getBinaryTypeDescription } from "./binary.js";

describe("isBinaryContent", () => {
  describe("content-type based detection", () => {
    it("should identify text/* as non-binary", () => {
      const body = Buffer.from("Hello, world!");
      expect(isBinaryContent(body, "text/plain")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
      expect(isBinaryContent(body, "text/html")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
      expect(isBinaryContent(body, "text/css")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should identify application/json as non-binary", () => {
      const body = Buffer.from('{"key": "value"}');
      expect(isBinaryContent(body, "application/json")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should identify application/xml as non-binary", () => {
      const body = Buffer.from("<root><item>test</item></root>");
      expect(isBinaryContent(body, "application/xml")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should identify +json suffix as non-binary", () => {
      const body = Buffer.from('{"key": "value"}');
      expect(isBinaryContent(body, "application/hal+json")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
      expect(isBinaryContent(body, "application/ld+json")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should identify +xml suffix as non-binary", () => {
      const body = Buffer.from("<root/>");
      expect(isBinaryContent(body, "application/svg+xml")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should detect binary bytes even when content-type says text", () => {
      // Simulates compressed body stored with a text content-type (e.g. gzip-encoded JSON)
      const binaryBody = Buffer.alloc(1000);
      for (let i = 0; i < 1000; i++) {
        binaryBody[i] = i % 2 === 0 ? 0 : 1; // Alternating null and SOH
      }
      expect(isBinaryContent(binaryBody, "application/json")).toEqual({
        isBinary: true,
        reason: "content-scan",
      });
      expect(isBinaryContent(binaryBody, "text/plain")).toEqual({
        isBinary: true,
        reason: "content-scan",
      });
      expect(isBinaryContent(binaryBody, "application/hal+json")).toEqual({
        isBinary: true,
        reason: "content-scan",
      });
    });

    it("should handle content-type with charset", () => {
      const body = Buffer.from("Hello");
      expect(isBinaryContent(body, "text/plain; charset=utf-8")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
      expect(isBinaryContent(body, "application/json; charset=utf-8")).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should identify image/* as binary", () => {
      const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      expect(isBinaryContent(body, "image/png")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
      expect(isBinaryContent(body, "image/jpeg")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
      expect(isBinaryContent(body, "image/gif")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });

    it("should identify audio/* as binary", () => {
      const body = Buffer.from([0x49, 0x44, 0x33]); // ID3 header
      expect(isBinaryContent(body, "audio/mpeg")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });

    it("should identify video/* as binary", () => {
      const body = Buffer.alloc(100);
      expect(isBinaryContent(body, "video/mp4")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });

    it("should identify application/pdf as binary", () => {
      const body = Buffer.from("%PDF-1.4");
      expect(isBinaryContent(body, "application/pdf")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });

    it("should identify application/octet-stream as binary", () => {
      const body = Buffer.alloc(100);
      expect(isBinaryContent(body, "application/octet-stream")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });

    it("should identify archive types as binary", () => {
      const body = Buffer.alloc(100);
      expect(isBinaryContent(body, "application/zip")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
      expect(isBinaryContent(body, "application/gzip")).toEqual({
        isBinary: true,
        reason: "content-type",
      });
    });
  });

  describe("byte scanning fallback", () => {
    it("should identify text content without content-type", () => {
      const body = Buffer.from("This is plain text content\nWith multiple lines\n");
      const result = isBinaryContent(body, undefined);
      expect(result.isBinary).toBe(false);
      expect(result.reason).toBe("content-scan");
    });

    it("should identify binary content without content-type", () => {
      // Create buffer with many null bytes and non-printable characters
      const body = Buffer.alloc(1000);
      for (let i = 0; i < 1000; i++) {
        body[i] = i % 2 === 0 ? 0 : 1; // Alternating null and SOH
      }
      const result = isBinaryContent(body, undefined);
      expect(result.isBinary).toBe(true);
      expect(result.reason).toBe("content-scan");
    });

    it("should handle UTF-8 text with extended characters", () => {
      const body = Buffer.from("Hello, 世界! Привет мир! 🎉");
      const result = isBinaryContent(body, undefined);
      expect(result.isBinary).toBe(false);
    });

    it("should handle empty body", () => {
      expect(isBinaryContent(Buffer.alloc(0), undefined)).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });

    it("should handle undefined body", () => {
      expect(isBinaryContent(undefined, undefined)).toEqual({
        isBinary: false,
        reason: "text-content-type",
      });
    });
  });
});

describe("getBinaryTypeDescription", () => {
  it("should return 'Image' for image types", () => {
    expect(getBinaryTypeDescription("image/png")).toBe("Image");
    expect(getBinaryTypeDescription("image/jpeg")).toBe("Image");
    expect(getBinaryTypeDescription("image/gif")).toBe("Image");
    expect(getBinaryTypeDescription("image/webp")).toBe("Image");
  });

  it("should return 'Audio' for audio types", () => {
    expect(getBinaryTypeDescription("audio/mpeg")).toBe("Audio");
    expect(getBinaryTypeDescription("audio/wav")).toBe("Audio");
    expect(getBinaryTypeDescription("audio/ogg")).toBe("Audio");
  });

  it("should return 'Video' for video types", () => {
    expect(getBinaryTypeDescription("video/mp4")).toBe("Video");
    expect(getBinaryTypeDescription("video/webm")).toBe("Video");
  });

  it("should return 'PDF' for PDF", () => {
    expect(getBinaryTypeDescription("application/pdf")).toBe("PDF");
  });

  it("should return 'Archive' for archive types", () => {
    expect(getBinaryTypeDescription("application/zip")).toBe("Archive");
    expect(getBinaryTypeDescription("application/gzip")).toBe("Archive");
    expect(getBinaryTypeDescription("application/x-tar")).toBe("Archive");
  });

  it("should return 'Font' for font types", () => {
    expect(getBinaryTypeDescription("font/woff")).toBe("Font");
    expect(getBinaryTypeDescription("font/woff2")).toBe("Font");
  });

  it("should capitalise unknown application types", () => {
    expect(getBinaryTypeDescription("application/unknown")).toBe("Unknown");
    expect(getBinaryTypeDescription("application/custom-format")).toBe("Custom-format");
  });

  it("should return 'Binary' for undefined content type", () => {
    expect(getBinaryTypeDescription(undefined)).toBe("Binary");
  });

  it("should handle content-type with parameters", () => {
    expect(getBinaryTypeDescription("image/png; charset=utf-8")).toBe("Image");
    expect(getBinaryTypeDescription("application/pdf; name=test.pdf")).toBe("PDF");
  });
});
