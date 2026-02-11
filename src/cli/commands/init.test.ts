import { describe, it, expect } from "vitest";
import { generateShellFunction } from "./init.js";

describe("generateShellFunction", () => {
  it("generates valid shell function syntax", () => {
    const output = generateShellFunction();

    // Should define a function named htpx
    expect(output).toContain("htpx()");

    // Should check for on and off commands
    expect(output).toContain('if [[ "$1" == "on" || "$1" == "off" ]]');

    // Should use eval for on/off
    expect(output).toContain("eval");

    // Should pass through other commands
    expect(output).toContain('command htpx "$@"');

    // Should be properly structured
    expect(output).toContain("{");
    expect(output).toContain("}");
  });

  it("passes through all arguments", () => {
    const output = generateShellFunction();

    // Should pass all arguments to command
    expect(output).toContain('command htpx "$@"');
  });
});
