import { describe, expect, test } from "bun:test";
import type { StudioBunRPC, StudioRPC, StudioWebviewRPC } from "../src/infrastructure/rpc/electrobun-rpc-contract";
import type {
  StudioWebviewBunRPC,
  StudioWebviewElectrobunRPC,
  StudioWebviewSideRPC
} from "../src/ui/electrobun-rpc-contract";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? (<T>() => T extends Right ? 1 : 2) extends <T>() => T extends Left ? 1 : 2
      ? true
      : false
    : false;

type Assert<T extends true> = T;

type _BunSideParity = Assert<Equal<StudioBunRPC, StudioWebviewBunRPC>>;
type _WebviewSideParity = Assert<Equal<StudioWebviewRPC, StudioWebviewSideRPC>>;
type _CompositeParity = Assert<Equal<StudioRPC["bun"], StudioWebviewElectrobunRPC["bun"]>>;
type _CompositeWebviewParity = Assert<Equal<StudioRPC["webview"], StudioWebviewElectrobunRPC["webview"]>>;

describe("Electrobun RPC wrapper parity", () => {
  test("main and UI wrappers compile against the same application contract", () => {
    const parityHolds: _BunSideParity & _WebviewSideParity & _CompositeParity & _CompositeWebviewParity = true;
    expect(parityHolds).toBe(true);
  });
});
