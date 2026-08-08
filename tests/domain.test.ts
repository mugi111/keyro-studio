import { describe, expect, test } from "bun:test";
import { createOpenUrlAction } from "../src/domain/action";
import { createEmptyProfile, validatePageConfig } from "../src/domain/profile";
import { defaultDeviceLayout, keyCount, validateDeviceLayout } from "../src/shared/device-layout";
import { validateOpenUrl } from "../src/shared/url";

describe("domain rules", () => {
  test("accepts only http and https open_url actions", () => {
    expect(validateOpenUrl("https://example.com").ok).toBe(true);
    expect(validateOpenUrl("http://example.com/path").ok).toBe(true);
    expect(validateOpenUrl("file:///tmp/nope").ok).toBe(false);
    expect(validateOpenUrl("javascript:alert(1)").ok).toBe(false);
  });

  test("creates profiles from variable device layout", () => {
    const layout = { pageCount: 2, keyRows: 2, keyColumns: 3, encoderCount: 1 };
    const profile = createEmptyProfile("p1", " Test  Profile ", layout, true);

    expect(profile.name).toBe("Test Profile");
    expect(profile.pages).toHaveLength(2);
    expect(profile.pages[0]?.keys).toHaveLength(6);
    expect(profile.pages[0]?.encoders).toHaveLength(1);
    expect(keyCount(layout)).toBe(6);
  });

  test("validates page shape against layout", () => {
    const profile = createEmptyProfile("p1", "Default", defaultDeviceLayout);
    expect(validatePageConfig(profile.pages[0]!, defaultDeviceLayout).ok).toBe(true);

    const invalid = structuredClone(profile.pages[0]!);
    invalid.keys.pop();
    expect(validatePageConfig(invalid, defaultDeviceLayout).ok).toBe(false);
  });

  test("rejects unsupported action URL schemes inside page config", () => {
    const profile = createEmptyProfile("p1", "Default", defaultDeviceLayout);
    profile.pages[0]!.keys[0]!.action = { kind: "open_url", url: "ftp://example.com" };
    expect(validatePageConfig(profile.pages[0]!, defaultDeviceLayout).ok).toBe(false);
  });

  test("guards device layout values", () => {
    expect(validateDeviceLayout({ pageCount: 1, keyRows: 1, keyColumns: 1, encoderCount: 1 }).ok).toBe(true);
    expect(validateDeviceLayout({ pageCount: 0, keyRows: 1, keyColumns: 1, encoderCount: 1 }).ok).toBe(false);
  });

  test("normalizes open_url action values", () => {
    const action = createOpenUrlAction("https://example.com/a b");
    expect(action.ok).toBe(true);
    if (action.ok) expect(action.value.url).toBe("https://example.com/a%20b");
  });
});
