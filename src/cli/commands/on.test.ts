import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import {
  formatEnvVars,
  formatUnsetVars,
  formatNodeOptionsExport,
  formatNodeOptionsRestore,
  formatPythonPathExport,
  formatPythonPathRestore,
  formatRubyOptExport,
  formatRubyOptRestore,
  formatPhpIniScanDirExport,
  formatPhpIniScanDirRestore,
} from "./on.js";

describe("formatEnvVars", () => {
  it("formats single env var", () => {
    const result = formatEnvVars({ FOO: "bar" });
    expect(result).toBe('export FOO="bar"');
  });

  it("formats multiple env vars", () => {
    const result = formatEnvVars({
      HTTP_PROXY: "http://localhost:8080",
      HTTPS_PROXY: "http://localhost:8080",
    });

    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('export HTTP_PROXY="http://localhost:8080"');
    expect(lines[1]).toBe('export HTTPS_PROXY="http://localhost:8080"');
  });

  it("handles empty object", () => {
    const result = formatEnvVars({});
    expect(result).toBe("");
  });

  it("handles paths with special characters", () => {
    const result = formatEnvVars({
      SSL_CERT_FILE: "/Users/test/.procsi/ca.pem",
    });
    expect(result).toBe('export SSL_CERT_FILE="/Users/test/.procsi/ca.pem"');
  });

  it("formats all standard procsi env vars", () => {
    const result = formatEnvVars({
      HTTP_PROXY: "http://127.0.0.1:9000",
      HTTPS_PROXY: "http://127.0.0.1:9000",
      SSL_CERT_FILE: "/path/to/ca.pem",
      REQUESTS_CA_BUNDLE: "/path/to/ca.pem",
      NODE_EXTRA_CA_CERTS: "/path/to/ca.pem",
      PROCSI_SESSION_ID: "abc-123",
      PROCSI_SESSION_TOKEN: "token-123",
      PROCSI_LABEL: "test-session",
    });

    expect(result).toContain("export HTTP_PROXY=");
    expect(result).toContain("export HTTPS_PROXY=");
    expect(result).toContain("export SSL_CERT_FILE=");
    expect(result).toContain("export REQUESTS_CA_BUNDLE=");
    expect(result).toContain("export NODE_EXTRA_CA_CERTS=");
    expect(result).toContain("export PROCSI_SESSION_ID=");
    expect(result).toContain("export PROCSI_SESSION_TOKEN=");
    expect(result).toContain("export PROCSI_LABEL=");
  });

  describe("shell injection prevention", () => {
    it("escapes dollar signs (command substitution)", () => {
      const result = formatEnvVars({ PROCSI_LABEL: "$(rm -rf /)" });
      expect(result).toBe('export PROCSI_LABEL="\\$(rm -rf /)"');
    });

    it("escapes backticks (legacy command substitution)", () => {
      const result = formatEnvVars({ PROCSI_LABEL: "`whoami`" });
      expect(result).toBe('export PROCSI_LABEL="\\`whoami\\`"');
    });

    it("escapes double quotes", () => {
      const result = formatEnvVars({ PROCSI_LABEL: 'say "hello"' });
      expect(result).toBe('export PROCSI_LABEL="say \\"hello\\""');
    });

    it("escapes backslashes", () => {
      const result = formatEnvVars({ PROCSI_LABEL: "path\\to\\file" });
      expect(result).toBe('export PROCSI_LABEL="path\\\\to\\\\file"');
    });

    it("escapes exclamation marks (history expansion)", () => {
      const result = formatEnvVars({ PROCSI_LABEL: "hello!world" });
      expect(result).toBe('export PROCSI_LABEL="hello\\!world"');
    });

    it("escapes multiple dangerous characters combined", () => {
      const result = formatEnvVars({ PROCSI_LABEL: '$(cmd) `cmd` "quoted" \\path!' });
      expect(result).toBe('export PROCSI_LABEL="\\$(cmd) \\`cmd\\` \\"quoted\\" \\\\path\\!"');
    });
  });
});

describe("formatUnsetVars", () => {
  it("formats single var", () => {
    const result = formatUnsetVars(["FOO"]);
    expect(result).toBe("unset FOO");
  });

  it("formats multiple vars", () => {
    const result = formatUnsetVars(["HTTP_PROXY", "HTTPS_PROXY"]);

    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("unset HTTP_PROXY");
    expect(lines[1]).toBe("unset HTTPS_PROXY");
  });

  it("handles empty array", () => {
    const result = formatUnsetVars([]);
    expect(result).toBe("");
  });

  it("includes all standard procsi env vars", () => {
    const result = formatUnsetVars([
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "SSL_CERT_FILE",
      "REQUESTS_CA_BUNDLE",
      "NODE_EXTRA_CA_CERTS",
      "PROCSI_SESSION_ID",
      "PROCSI_SESSION_TOKEN",
      "PROCSI_LABEL",
    ]);

    expect(result).toContain("unset HTTP_PROXY");
    expect(result).toContain("unset HTTPS_PROXY");
    expect(result).toContain("unset SSL_CERT_FILE");
    expect(result).toContain("unset REQUESTS_CA_BUNDLE");
    expect(result).toContain("unset NODE_EXTRA_CA_CERTS");
    expect(result).toContain("unset PROCSI_SESSION_ID");
    expect(result).toContain("unset PROCSI_SESSION_TOKEN");
    expect(result).toContain("unset PROCSI_LABEL");
  });
});

describe("formatNodeOptionsExport", () => {
  const preloadPath = "/Users/test/.procsi/proxy-preload.cjs";

  it("saves original NODE_OPTIONS via ${param-word} guard", () => {
    const result = formatNodeOptionsExport(preloadPath);
    // Uses ${PROCSI_ORIG_NODE_OPTIONS-...} (without colon) so it only falls through when truly unset
    expect(result).toContain("PROCSI_ORIG_NODE_OPTIONS");
    expect(result).toContain("${PROCSI_ORIG_NODE_OPTIONS-${NODE_OPTIONS:-}}");
  });

  it("appends --require with the preload path", () => {
    const result = formatNodeOptionsExport(preloadPath);
    expect(result).toContain("--require");
    expect(result).toContain(preloadPath);
  });

  it("does not wrap the preload path in single quotes", () => {
    const result = formatNodeOptionsExport(preloadPath);
    // Single quotes inside double-quoted shell strings are literal — they must not appear
    expect(result).not.toContain(`'${preloadPath}'`);
    expect(result).not.toMatch(/--require\s+'/);
  });

  it("preserves existing NODE_OPTIONS when appending", () => {
    const result = formatNodeOptionsExport(preloadPath);
    // Should use ${PROCSI_ORIG_NODE_OPTIONS:+...} to conditionally prepend original value
    expect(result).toContain("${PROCSI_ORIG_NODE_OPTIONS:+");
  });

  it("exports NODE_OPTIONS", () => {
    const result = formatNodeOptionsExport(preloadPath);
    expect(result).toContain("export NODE_OPTIONS=");
  });

  it("does not use if/then/fi (breaks in eval $() under zsh)", () => {
    const result = formatNodeOptionsExport(preloadPath);
    expect(result).not.toContain("if ");
    expect(result).not.toContain("then");
    expect(result).not.toContain("fi");
  });

  it("produces NODE_OPTIONS without literal quote characters after shell eval", () => {
    const result = formatNodeOptionsExport(preloadPath);
    // Evaluate the shell output and inspect the resulting NODE_OPTIONS value
    const nodeOptions = execSync(`bash -c '${result.replace(/'/g, "'\\''")}\necho "$NODE_OPTIONS"'`)
      .toString()
      .trim();
    expect(nodeOptions).toBe(`--require ${preloadPath}`);
    expect(nodeOptions).not.toContain("'");
  });

  it("handles paths with spaces correctly after shell eval", () => {
    const spacePath = "/Users/test user/.procsi/proxy-preload.cjs";
    const result = formatNodeOptionsExport(spacePath);
    const nodeOptions = execSync(`bash -c '${result.replace(/'/g, "'\\''")}\necho "$NODE_OPTIONS"'`)
      .toString()
      .trim();
    expect(nodeOptions).toBe(`--require ${spacePath}`);
    expect(nodeOptions).not.toContain("'");
  });

  it("escapes double-quote-significant characters in the path", () => {
    const trickyPath = "/Users/test/.procsi/proxy-preload.cjs";
    const result = formatNodeOptionsExport(trickyPath);
    // The path should be escaped for double-quoted context (backslash, $, `, ", !)
    // but should not contain single quotes
    expect(result).not.toMatch(/--require\s+'/);
  });
});

describe("formatNodeOptionsRestore", () => {
  it("restores NODE_OPTIONS from saved value when non-empty", () => {
    const result = formatNodeOptionsRestore();
    expect(result).toContain("PROCSI_ORIG_NODE_OPTIONS");
    expect(result).toContain("export NODE_OPTIONS=");
  });

  it("unsets NODE_OPTIONS when original was empty", () => {
    const result = formatNodeOptionsRestore();
    expect(result).toContain("unset NODE_OPTIONS");
  });

  it("cleans up PROCSI_ORIG_NODE_OPTIONS", () => {
    const result = formatNodeOptionsRestore();
    expect(result).toContain("unset PROCSI_ORIG_NODE_OPTIONS");
  });
});

describe("formatPythonPathExport", () => {
  const overrideDir = "/Users/test/.procsi/overrides/python";

  it("saves original PYTHONPATH via ${param-word} guard", () => {
    const result = formatPythonPathExport(overrideDir);
    expect(result).toContain("PROCSI_ORIG_PYTHONPATH");
    expect(result).toContain("${PROCSI_ORIG_PYTHONPATH-${PYTHONPATH:-}}");
  });

  it("prepends the override dir to PYTHONPATH", () => {
    const result = formatPythonPathExport(overrideDir);
    expect(result).toContain("export PYTHONPATH=");
    expect(result).toContain(overrideDir);
  });

  it("does not use if/then/fi", () => {
    const result = formatPythonPathExport(overrideDir);
    expect(result).not.toContain("if ");
    expect(result).not.toContain("then");
    expect(result).not.toContain("fi");
  });

  it("produces PYTHONPATH with override dir after shell eval", () => {
    const result = formatPythonPathExport(overrideDir);
    const pythonPath = execSync(`bash -c '${result.replace(/'/g, "'\\''")}\necho "$PYTHONPATH"'`)
      .toString()
      .trim();
    expect(pythonPath).toBe(overrideDir);
  });

  it("preserves existing PYTHONPATH when prepending", () => {
    const result = formatPythonPathExport(overrideDir);
    const pythonPath = execSync(
      `bash -c 'export PYTHONPATH="/existing/path"\n${result.replace(/'/g, "'\\''")}\necho "$PYTHONPATH"'`
    )
      .toString()
      .trim();
    expect(pythonPath).toBe(`${overrideDir}:/existing/path`);
  });
});

describe("formatPythonPathRestore", () => {
  it("restores PYTHONPATH from saved value", () => {
    const result = formatPythonPathRestore();
    expect(result).toContain("PROCSI_ORIG_PYTHONPATH");
  });

  it("unsets PYTHONPATH when original was empty", () => {
    const result = formatPythonPathRestore();
    expect(result).toContain("unset PYTHONPATH");
  });

  it("cleans up PROCSI_ORIG_PYTHONPATH", () => {
    const result = formatPythonPathRestore();
    expect(result).toContain("unset PROCSI_ORIG_PYTHONPATH");
  });
});

describe("formatRubyOptExport", () => {
  const overridePath = "/Users/test/.procsi/overrides/ruby/procsi_intercept.rb";

  it("saves original RUBYOPT via ${param-word} guard", () => {
    const result = formatRubyOptExport(overridePath);
    expect(result).toContain("PROCSI_ORIG_RUBYOPT");
    expect(result).toContain("${PROCSI_ORIG_RUBYOPT-${RUBYOPT:-}}");
  });

  it("appends -r with the override path", () => {
    const result = formatRubyOptExport(overridePath);
    expect(result).toContain("-r ");
    expect(result).toContain(overridePath);
  });

  it("exports RUBYOPT", () => {
    const result = formatRubyOptExport(overridePath);
    expect(result).toContain("export RUBYOPT=");
  });

  it("produces RUBYOPT with -r flag after shell eval", () => {
    const result = formatRubyOptExport(overridePath);
    const rubyOpt = execSync(`bash -c '${result.replace(/'/g, "'\\''")}\necho "$RUBYOPT"'`)
      .toString()
      .trim();
    expect(rubyOpt).toBe(`-r ${overridePath}`);
  });

  it("preserves existing RUBYOPT when appending", () => {
    const result = formatRubyOptExport(overridePath);
    const rubyOpt = execSync(
      `bash -c 'export RUBYOPT="-w"\n${result.replace(/'/g, "'\\''")}\necho "$RUBYOPT"'`
    )
      .toString()
      .trim();
    expect(rubyOpt).toBe(`-w -r ${overridePath}`);
  });
});

describe("formatRubyOptRestore", () => {
  it("restores RUBYOPT from saved value", () => {
    const result = formatRubyOptRestore();
    expect(result).toContain("PROCSI_ORIG_RUBYOPT");
  });

  it("unsets RUBYOPT when original was empty", () => {
    const result = formatRubyOptRestore();
    expect(result).toContain("unset RUBYOPT");
  });

  it("cleans up PROCSI_ORIG_RUBYOPT", () => {
    const result = formatRubyOptRestore();
    expect(result).toContain("unset PROCSI_ORIG_RUBYOPT");
  });
});

describe("formatPhpIniScanDirExport", () => {
  const overrideDir = "/Users/test/.procsi/overrides/php";

  it("saves original PHP_INI_SCAN_DIR via ${param-word} guard", () => {
    const result = formatPhpIniScanDirExport(overrideDir);
    expect(result).toContain("PROCSI_ORIG_PHP_INI_SCAN_DIR");
    expect(result).toContain("${PROCSI_ORIG_PHP_INI_SCAN_DIR-${PHP_INI_SCAN_DIR:-}}");
  });

  it("exports PHP_INI_SCAN_DIR with colon prefix", () => {
    const result = formatPhpIniScanDirExport(overrideDir);
    expect(result).toContain("export PHP_INI_SCAN_DIR=");
  });

  it("produces PHP_INI_SCAN_DIR with colon prefix after shell eval", () => {
    const result = formatPhpIniScanDirExport(overrideDir);
    const phpIniScanDir = execSync(
      `bash -c '${result.replace(/'/g, "'\\''")}\necho "$PHP_INI_SCAN_DIR"'`
    )
      .toString()
      .trim();
    // Should start with `:` (tells PHP to scan default dirs too)
    expect(phpIniScanDir).toBe(`:${overrideDir}`);
  });

  it("preserves existing PHP_INI_SCAN_DIR when appending", () => {
    const result = formatPhpIniScanDirExport(overrideDir);
    const phpIniScanDir = execSync(
      `bash -c 'export PHP_INI_SCAN_DIR="/etc/php.d"\n${result.replace(/'/g, "'\\''")}\necho "$PHP_INI_SCAN_DIR"'`
    )
      .toString()
      .trim();
    expect(phpIniScanDir).toBe(`:${"/etc/php.d"}:${overrideDir}`);
  });
});

describe("formatPhpIniScanDirRestore", () => {
  it("restores PHP_INI_SCAN_DIR from saved value", () => {
    const result = formatPhpIniScanDirRestore();
    expect(result).toContain("PROCSI_ORIG_PHP_INI_SCAN_DIR");
  });

  it("unsets PHP_INI_SCAN_DIR when original was empty", () => {
    const result = formatPhpIniScanDirRestore();
    expect(result).toContain("unset PHP_INI_SCAN_DIR");
  });

  it("cleans up PROCSI_ORIG_PHP_INI_SCAN_DIR", () => {
    const result = formatPhpIniScanDirRestore();
    expect(result).toContain("unset PROCSI_ORIG_PHP_INI_SCAN_DIR");
  });
});
