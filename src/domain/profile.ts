import { keyCount, type DeviceLayout } from "../shared/device-layout";
import { err, ok, type Result } from "../shared/result";
import { validateAction, type Action } from "./action";

export type KeyBinding = {
  index: number;
  action: Action | null;
};

export type EncoderBinding = {
  index: number;
  rotateLeft: Action | null;
  rotateRight: Action | null;
  press: Action | null;
};

export type PageConfig = {
  index: number;
  keys: KeyBinding[];
  encoders: EncoderBinding[];
};

export type Profile = {
  id: string;
  name: string;
  active: boolean;
  pages: PageConfig[];
};

export type StudioSnapshot = {
  layout: DeviceLayout;
  profiles: Profile[];
  activeProfileId: string | null;
};

export function createEmptyPage(index: number, layout: DeviceLayout): PageConfig {
  return {
    index,
    keys: Array.from({ length: keyCount(layout) }, (_, keyIndex) => ({
      index: keyIndex,
      action: null
    })),
    encoders: Array.from({ length: layout.encoderCount }, (_, encoderIndex) => ({
      index: encoderIndex,
      rotateLeft: null,
      rotateRight: null,
      press: null
    }))
  };
}

export function createEmptyProfile(id: string, name: string, layout: DeviceLayout, active = false): Profile {
  return {
    id,
    name: normalizeProfileName(name),
    active,
    pages: Array.from({ length: layout.pageCount }, (_, pageIndex) => createEmptyPage(pageIndex, layout))
  };
}

export function normalizeProfileName(name: string): string {
  return name.trim().replace(/\s+/g, " ") || "Untitled Profile";
}

export function validatePageConfig(page: PageConfig, layout: DeviceLayout): Result<PageConfig> {
  if (page.index < 0 || page.index >= layout.pageCount) {
    return err("validation_error", "Page index is outside the device layout.");
  }
  if (page.keys.length !== keyCount(layout)) {
    return err("validation_error", "Key count does not match the device layout.");
  }
  if (page.encoders.length !== layout.encoderCount) {
    return err("validation_error", "Encoder count does not match the device layout.");
  }

  for (const key of page.keys) {
    if (key.index < 0 || key.index >= keyCount(layout)) {
      return err("validation_error", "Key index is outside the device layout.");
    }
    const action = validateAction(key.action);
    if (!action.ok) return action;
  }

  for (const encoder of page.encoders) {
    if (encoder.index < 0 || encoder.index >= layout.encoderCount) {
      return err("validation_error", "Encoder index is outside the device layout.");
    }
    for (const action of [encoder.rotateLeft, encoder.rotateRight, encoder.press]) {
      const validated = validateAction(action);
      if (!validated.ok) return validated;
    }
  }

  return ok(page);
}

export function cloneSnapshot(snapshot: StudioSnapshot): StudioSnapshot {
  return structuredClone(snapshot);
}
