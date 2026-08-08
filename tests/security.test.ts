import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
});
