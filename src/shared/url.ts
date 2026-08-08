import { err, ok, type Result } from "./result";

const allowedSchemes = new Set(["http:", "https:"]);

export function validateOpenUrl(input: string): Result<string> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return err("invalid_url", "URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return err("invalid_url", "URL must be absolute and include http or https.");
  }

  if (!allowedSchemes.has(parsed.protocol)) {
    return err("invalid_url", "Only http and https URLs are allowed.");
  }

  return ok(parsed.toString());
}

export function allowedOpenUrlSchemes(): string[] {
  return ["http", "https"];
}
