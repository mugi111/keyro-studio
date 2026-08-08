import { validateOpenUrl } from "../shared/url";
import { err, ok, type Result } from "../shared/result";

export type OpenUrlAction = {
  kind: "open_url";
  url: string;
};

export type Action = OpenUrlAction;

export function createOpenUrlAction(url: string): Result<OpenUrlAction> {
  const validated = validateOpenUrl(url);
  if (!validated.ok) return validated;
  return ok({ kind: "open_url", url: validated.value });
}

export function validateAction(action: Action | null): Result<Action | null> {
  if (action == null) return ok(null);
  if (action.kind !== "open_url") {
    return err("validation_error", "Only open_url actions are supported.");
  }
  return createOpenUrlAction(action.url);
}
