import { describe, expect, test } from "bun:test";
import { importSpecifiersFromSource } from "./helpers/import-specifiers";

describe("import specifier extraction", () => {
  test("extracts static, side-effect, re-export, dynamic import, and literal require specifiers", () => {
    const specifiers = importSpecifiersFromSource(
      "sample.ts",
      `
        import type { Thing } from "../domain/thing";
        import { value } from "../shared/value";
        import "../infrastructure/setup";
        export { item } from "../ui/item";
        export * from "electrobun";
        await import("node:fs");
        const loaded = require("bun:test");
      `
    ).map((item) => item.specifier);

    expect(specifiers).toEqual([
      "../domain/thing",
      "../shared/value",
      "../infrastructure/setup",
      "../ui/item",
      "electrobun",
      "node:fs",
      "bun:test"
    ]);
  });

  test("ignores comments, normal strings, and non-literal dynamic imports", () => {
    const specifiers = importSpecifiersFromSource(
      "sample.ts",
      `
        // import "../infrastructure/commented";
        const text = 'import("node:fs")';
        const moduleName = "../ui/dynamic";
        await import(moduleName);
        require(moduleName);
      `
    );

    expect(specifiers).toEqual([]);
  });

  test("extracts consecutive semicolonless imports and re-exports", () => {
    const specifiers = importSpecifiersFromSource(
      "sample.ts",
      `
        import { a } from "../shared/a"
        import "../infrastructure/setup"
        export { b } from "../ui/b"
      `
    ).map((item) => item.specifier);

    expect(specifiers).toEqual(["../shared/a", "../infrastructure/setup", "../ui/b"]);
  });

  test("extracts template-literal module specifiers and ignores method require calls", () => {
    const specifiers = importSpecifiersFromSource(
      "sample.ts",
      [
        "await import(`../infrastructure/template`);",
        "const loaded = require(`node:path`);",
        "loader.require(`node:fs`);"
      ].join("\n")
    ).map((item) => item.specifier);

    expect(specifiers).toEqual(["../infrastructure/template", "node:path"]);
  });
});
