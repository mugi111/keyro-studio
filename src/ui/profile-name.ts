import { normalizeProfileName } from "../domain/profile";

export type ProfileNameSubmission =
  | { kind: "invalid"; message: string }
  | { kind: "submit"; normalizedName: string };

export type ProfileRenameIntent =
  | { kind: "invalid"; message: string }
  | { kind: "unchanged"; normalizedName: string; message: string }
  | { kind: "submit"; normalizedName: string };

export function profileNameSubmission(input: string): ProfileNameSubmission {
  if (!input.trim()) return { kind: "invalid", message: "Profile name is required." };
  return { kind: "submit", normalizedName: normalizeProfileName(input) };
}

export function profileRenameIntent(currentName: string | null, input: string): ProfileRenameIntent {
  const submission = profileNameSubmission(input);
  if (submission.kind === "invalid") return submission;
  if (!currentName) return { kind: "invalid", message: "No profile is selected." };
  if (normalizeProfileName(currentName) === submission.normalizedName) {
    return {
      kind: "unchanged",
      normalizedName: submission.normalizedName,
      message: "Profile name unchanged."
    };
  }
  return submission;
}
