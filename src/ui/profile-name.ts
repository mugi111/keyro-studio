import { normalizeProfileName } from "../domain/profile";

export type ProfileNameSubmission =
  | { state: "invalid" }
  | { state: "unchanged"; name: string }
  | { state: "submit"; name: string };

export function classifyNewProfileName(rawName: string): Exclude<ProfileNameSubmission, { state: "unchanged" }> {
  if (!rawName.trim()) return { state: "invalid" };
  return { state: "submit", name: normalizeProfileName(rawName) };
}

export function classifyProfileRename(rawName: string, currentName: string): ProfileNameSubmission {
  const submission = classifyNewProfileName(rawName);
  if (submission.state !== "submit") return submission;
  return submission.name === currentName ? { state: "unchanged", name: submission.name } : submission;
}
