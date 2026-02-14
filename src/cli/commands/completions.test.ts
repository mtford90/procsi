/**
 * Tests for the completions command generators.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Command } from "commander";
import { completionsCommand } from "./completions.js";

describe("completions command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runCompletions(shell: string): string {
    let output = "";
    vi.spyOn(console, "log").mockImplementation((msg: string) => {
      output += msg + "\n";
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    // Build a minimal program tree for the generator to walk
    const program = new Command("procsi")
      .option("-v, --verbose", "increase verbosity")
      .option("-d, --dir <path>", "override project root");

    program.addCommand(
      new Command("requests")
        .description("List captured requests")
        .option("--method <m>", "filter by method")
        .option("--json", "JSON output")
    );

    program.addCommand(
      new Command("sessions").description("List active sessions").option("--json", "JSON output")
    );

    program.addCommand(completionsCommand);

    try {
      // Run the completions command
      program.parse(["node", "procsi", "completions", shell]);
    } catch (e) {
      // If process.exit was called, we threw an error - check if it was expected
      if ((e as Error).message !== "process.exit called") {
        throw e;
      }
      // If exit was called with code 1 (error), exitSpy will have been called
      if (exitSpy.mock.calls.length > 0) {
        throw e;
      }
    }

    return output;
  }

  describe("zsh completions", () => {
    it("generates valid zsh completion script", () => {
      const output = runCompletions("zsh");
      expect(output).toContain("compdef _procsi procsi");
      expect(output).toContain("_procsi");
      expect(output).toContain("requests");
      expect(output).toContain("sessions");
    });

    it("includes subcommand options", () => {
      const output = runCompletions("zsh");
      expect(output).toContain("--method");
      expect(output).toContain("--json");
    });
  });

  describe("bash completions", () => {
    it("generates valid bash completion script", () => {
      const output = runCompletions("bash");
      expect(output).toContain("complete -F _procsi procsi");
      expect(output).toContain("requests");
      expect(output).toContain("sessions");
    });
  });

  describe("fish completions", () => {
    it("generates valid fish completion script", () => {
      const output = runCompletions("fish");
      expect(output).toContain("complete -c procsi");
      expect(output).toContain("requests");
      expect(output).toContain("sessions");
    });
  });

  it("rejects unsupported shells", () => {
    let errorOutput = "";
    vi.spyOn(console, "error").mockImplementation((msg: string) => {
      errorOutput += msg + "\n";
    });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    const program = new Command("procsi");
    program.addCommand(completionsCommand);

    expect(() => {
      program.parse(["node", "procsi", "completions", "powershell"]);
    }).toThrow("process.exit called");
    expect(errorOutput).toContain("Unsupported shell");
  });

  it("does not contain unescaped single quotes in descriptions", () => {
    // Verify the escapeForShell function works by checking output doesn't break
    const output = runCompletions("zsh");
    // The output should be parseable (no unclosed single quotes)
    // Count single quotes - should be even (all properly paired)
    const singleQuotes = (output.match(/'/g) ?? []).length;
    expect(singleQuotes % 2).toBe(0);
  });
});
