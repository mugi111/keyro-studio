import { describe, expect, test } from "bun:test";
import { describeGridColumns } from "../src/ui/dom";
import { initialUIState, reduceCoreEvent } from "../src/ui/state";
import { createEmptyProfile } from "../src/domain/profile";

describe("ui state", () => {
  test("selects active profile and clamps selected page", () => {
    const layout = { pageCount: 2, keyRows: 2, keyColumns: 2, encoderCount: 1 };
    const profile = createEmptyProfile("p1", "Default", layout, true);
    const state = reduceCoreEvent(
      { ...initialUIState, selectedPageIndex: 99 },
      { type: "snapshot", snapshot: { layout, profiles: [profile], activeProfileId: "p1" } }
    );

    expect(state.selectedProfileId).toBe("p1");
    expect(state.selectedPageIndex).toBe(1);
  });

  test("describes variable key grids for component tests", () => {
    expect(describeGridColumns(3, 4)).toBe("3x4:12");
    expect(describeGridColumns(2, 5)).toBe("2x5:10");
  });
});
