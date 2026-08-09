export type ImportSpecifier = {
  file: string;
  specifier: string;
};

export function importSpecifiersFromSource(file: string, source: string): ImportSpecifier[] {
  const sanitized = stripCommentsAndNonModuleStrings(source);
  const specifiers: ImportSpecifier[] = [];

  for (const match of sanitized.matchAll(/(?:^|[;\n])\s*(import|export)\b([\s\S]*?)(?=;|\n\s*(?:import|export)\b|$)/g)) {
    const statement = match[2] ?? "";
    const fromMatch = statement.match(/\bfrom\s+(["'`])([^"'`]+)\1/);
    const sideEffectMatch = match[1] === "import" ? statement.match(/^\s*(["'`])([^"'`]+)\1/) : null;
    const specifier = fromMatch?.[2] ?? sideEffectMatch?.[2];
    if (specifier) {
      specifiers.push({ file, specifier });
    }
  }

  for (const pattern of [/\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g, /(?<!\.)\brequire\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g]) {
    for (const match of sanitized.matchAll(pattern)) {
      specifiers.push({ file, specifier: match[2] ?? "" });
    }
  }
  return specifiers;
}

function stripCommentsAndNonModuleStrings(source: string): string {
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) break;
      output += "\n";
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const comment = source.slice(index, end === -1 ? source.length : end + 2);
      output += "\n".repeat(comment.split("\n").length - 1);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      if (/(?:\bfrom|\bimport|\brequire)\s*\(?\s*$/.test(output)) {
        output += readQuoted(source, index).value;
      } else {
        output += char === "`" ? "``" : `${char}${char}`;
      }
      index = readQuoted(source, index).end;
      continue;
    }

    output += char;
  }
  return output;
}

function readQuoted(source: string, start: number): { value: string; end: number } {
  const quote = source[start]!;
  let value = quote;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]!;
    value += char;
    if (char === "\\") {
      index += 1;
      value += source[index] ?? "";
      continue;
    }
    if (char === quote) return { value, end: index };
  }
  return { value, end: source.length - 1 };
}
