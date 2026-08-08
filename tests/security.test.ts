import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function readFilesUnder(directory: string, extension: string): string {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        return readFilesUnder(path, extension);
      }
      return path.endsWith(extension) ? readFileSync(path, "utf8") : "";
    })
    .join("\n");
}

describe("security guardrails", () => {
  test("browser HTML uses restrictive CSP and local views assets", () => {
    const html = readFileSync("src/ui/index.html", "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-ancestors 'none'");
    expect(html).toContain("views://studio/index.js");
    expect(html).not.toContain("https://");
  });

  test("main window loads local views only and avoids tray/background features", () => {
    const main = readFileSync("src/infrastructure/main/index.ts", "utf8");
    expect(main).toContain("views://studio/index.html");
    expect(main).toContain("setNavigationRules");
    expect(main).toContain("registerAppLifecycle");
    expect(main).not.toContain("Tray");
    expect(main).not.toContain("sqlite");
  });

  test("core adapter selection stays in main infrastructure", () => {
    const factory = readFileSync("src/infrastructure/main/core-adapter-factory.ts", "utf8");
    const ui = readFileSync("src/ui/index.ts", "utf8") + readFileSync("src/ui/dom.ts", "utf8");

    expect(factory).toContain("KEYRO_STUDIO_CORE_MODE");
    expect(factory).toContain("local-ipc");
    expect(ui).not.toContain("KEYRO_STUDIO_CORE_MODE");
  });

  test("ui has no direct bun, node, fs, pipe, or socket access", () => {
    const ui = readFileSync("src/ui/index.ts", "utf8") + readFileSync("src/ui/dom.ts", "utf8");
    expect(ui).not.toMatch(/from ["']bun:/);
    expect(ui).not.toMatch(/from ["']node:/);
    expect(ui).not.toMatch(/fs\./);
    expect(ui).not.toContain("named pipe");
    expect(ui).not.toContain("Unix socket");
  });

  test("ui does not import main infrastructure", () => {
    const ui = readFilesUnder("src/ui", ".ts");
    expect(ui).not.toMatch(/from ["'][^"']*infrastructure\/main/);
    expect(ui).not.toMatch(/import\(["'][^"']*infrastructure\/main/);
  });
});
