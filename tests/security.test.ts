import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  studioNavigationRules,
  studioViewUrl,
  studioWindowSecurityPolicy
} from "../src/infrastructure/main/window-policy";
import { importSpecifiersFromSource } from "./helpers/import-specifiers";

type SourceFile = {
  path: string;
  content: string;
};

function sourceFilesUnder(directory: string, extension: string): SourceFile[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        return sourceFilesUnder(path, extension);
      }
      return path.endsWith(extension) ? [{ path, content: readFileSync(path, "utf8") }] : [];
    });
}

function readFilesUnder(directory: string, extension: string): string {
  return sourceFilesUnder(directory, extension)
    .map((file) => file.content)
    .join("\n");
}

function importedSpecifiersUnder(directory: string): Array<{ file: string; specifier: string }> {
  return sourceFilesUnder(directory, ".ts").flatMap((file) =>
    importSpecifiersFromSource(file.path, file.content)
  );
}

function expectNoImports(directory: string, blocked: RegExp[]): void {
  const violations = importedSpecifiersUnder(directory).filter(({ specifier }) =>
    blocked.some((pattern) => pattern.test(specifier))
  );
  expect(violations).toEqual([]);
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
    expect(studioViewUrl).toBe("views://studio/index.html");
    expect(studioNavigationRules).toEqual(["views://studio/*"]);
    expect(studioWindowSecurityPolicy.sandbox).toBe(false);
    expect(studioWindowSecurityPolicy.reason).toContain("typed Bun RPC bridge");
    expect(main).toContain("studioViewUrl");
    expect(main).toContain("setNavigationRules");
    expect(main).toContain("studioWindowSecurityPolicy.sandbox");
    expect(main).toContain("registerAppLifecycle");
    expect(main).not.toContain("Tray");
    expect(main).not.toContain("sqlite");
  });

  test("core adapter selection stays in main infrastructure", () => {
    const factory = readFileSync("src/infrastructure/main/core-adapter-factory.ts", "utf8");
    const ui = readFilesUnder("src/ui", ".ts");

    expect(factory).toContain("KEYRO_STUDIO_CORE_MODE");
    expect(readFileSync("src/infrastructure/main/action-executor-factory.ts", "utf8")).toContain(
      "KEYRO_STUDIO_ACTION_EXECUTOR"
    );
    expect(ui).not.toContain("KEYRO_STUDIO_CORE_MODE");
    expect(ui).not.toContain("KEYRO_STUDIO_ACTION_EXECUTOR");
  });

  test("ui has no direct bun, node, fs, pipe, or socket access", () => {
    const ui = readFilesUnder("src/ui", ".ts");
    expect(ui).not.toMatch(/from ["']bun:/);
    expect(ui).not.toMatch(/from ["']node:/);
    expect(ui).not.toMatch(/fs\./);
    expect(ui).not.toMatch(/openExternal|shell\.open|execFile|spawn\(/);
    expect(ui).not.toContain("named pipe");
    expect(ui).not.toContain("Unix socket");
  });

  test("ui does not import infrastructure", () => {
    const ui = readFilesUnder("src/ui", ".ts");
    expect(ui).not.toMatch(/from ["'][^"']*infrastructure\//);
    expect(ui).not.toMatch(/import\(["'][^"']*infrastructure\//);
  });

  test("shared layer does not import upward or framework modules", () => {
    expectNoImports("src/shared", [
      /\.\.\/domain/,
      /\.\.\/application/,
      /\.\.\/infrastructure/,
      /\.\.\/ui/,
      /^bun:/,
      /^node:/,
      /^electrobun/
    ]);
  });

  test("domain layer stays pure and does not import upward or framework modules", () => {
    expectNoImports("src/domain", [/\.\.\/application/, /\.\.\/infrastructure/, /\.\.\/ui/, /^bun:/, /^node:/, /^electrobun/]);
  });

  test("application layer depends only on ports, domain, and shared contracts", () => {
    expectNoImports("src/application", [/\.\.\/infrastructure/, /\.\.\/ui/, /^bun:/, /^node:/, /^electrobun/]);
  });
});
