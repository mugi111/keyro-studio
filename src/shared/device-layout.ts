import { err, ok, type Result } from "./result";

export type DeviceLayout = {
  pageCount: number;
  keyRows: number;
  keyColumns: number;
  encoderCount: number;
};

export const defaultDeviceLayout: DeviceLayout = {
  pageCount: 4,
  keyRows: 3,
  keyColumns: 4,
  encoderCount: 2
};

export function keyCount(layout: DeviceLayout): number {
  return layout.keyRows * layout.keyColumns;
}

export function validateDeviceLayout(layout: DeviceLayout): Result<DeviceLayout> {
  const entries: Array<[keyof DeviceLayout, number]> = [
    ["pageCount", layout.pageCount],
    ["keyRows", layout.keyRows],
    ["keyColumns", layout.keyColumns],
    ["encoderCount", layout.encoderCount]
  ];

  for (const [name, value] of entries) {
    if (!Number.isInteger(value) || value < 1) {
      return err("validation_error", `${name} must be a positive integer.`);
    }
  }

  if (keyCount(layout) > 96) {
    return err("validation_error", "A page cannot contain more than 96 keys.");
  }

  return ok(layout);
}
