import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import schema from "@mugi111/keyro-protocol/schemas/v0.2.0/core-studio";
import snapshotVector from "@mugi111/keyro-protocol/test-vectors/v0.2.0/snapshot-response";
import {
  KEYRO_PROTOCOL_HANDSHAKE_VERSION,
  KEYRO_PROTOCOL_VERSION,
  type ClientEnvelope,
  type ServerMessage
} from "@mugi111/keyro-protocol/core-studio/v0.2.0";
import {
  KEYRO_PROTOCOL_VERSION as STUDIO_PROTOCOL_VERSION,
  createClientEnvelope,
  keyroProtocolVersion
} from "../src/infrastructure/main/core-protocol";
import { importSpecifiersFromSource } from "./helpers/import-specifiers";

describe("@mugi111/keyro-protocol package consumption", () => {
  test("uses the Core-owned v0.2.0 contract constants through the Studio infrastructure facade", () => {
    expect(KEYRO_PROTOCOL_VERSION).toBe("0.2.0");
    expect(KEYRO_PROTOCOL_HANDSHAKE_VERSION).toEqual({ major: 0, minor: 2 });
    expect(STUDIO_PROTOCOL_VERSION).toBe(KEYRO_PROTOCOL_VERSION);
    expect(keyroProtocolVersion).toEqual(KEYRO_PROTOCOL_HANDSHAKE_VERSION);
  });

  test("resolves schema and snapshot vectors from versioned package exports", () => {
    expect(schema.$id).toBe("https://keyro.dev/protocol/v0.2.0/core-studio.schema.json");

    const snapshot = snapshotVector as unknown as ServerMessage;
    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type === "snapshot") {
      expect(snapshot.layout).toEqual({ page_count: 4, key_rows: 3, key_columns: 4, encoder_count: 2 });
      expect(snapshot.assignments[0]?.actions[0]).toEqual({ kind: "open_url", url: "https://example.com" });
    }
  });

  test("keeps Studio client envelope creation typed against the package contract", () => {
    const envelope: ClientEnvelope = createClientEnvelope("request-package", { type: "get_snapshot" });

    expect(envelope).toEqual({
      request_id: "request-package",
      message: { type: "get_snapshot" }
    });
  });

  test("imports the protocol package from production source only through the infrastructure facade", () => {
    const violations = sourceFilesUnder("src", ".ts")
      .flatMap((file) =>
        importSpecifiersFromSource(file.path, file.content).map((item) => ({
          file: normalize(file.path),
          specifier: item.specifier
        }))
      )
      .filter((item) => item.specifier.startsWith("@mugi111/keyro-protocol"))
      .filter((item) => item.file !== normalize("src/infrastructure/main/core-protocol.ts"));

    expect(violations).toEqual([]);
  });
});

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
