import { homedir } from "node:os";
import { join } from "node:path";

export function defaultCoreEndpoint(platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (platform === "win32") return String.raw`\\.\pipe\keyro-core-dev`;
  if (platform === "darwin") return join(home, "Library", "Application Support", "Keyro", "Core", "keyro-core-dev.sock");
  return join(home, ".local", "share", "keyro", "core", "keyro-core-dev.sock");
}
