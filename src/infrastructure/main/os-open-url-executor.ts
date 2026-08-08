import type { ActionExecutorPort, ActionExecutionStatus } from "../../application/ports/action-executor-port";
import type { Action } from "../../domain/action";
import { validateOpenUrl } from "../../shared/url";

export type OpenUrlFn = (url: string) => boolean | Promise<boolean>;

export class OsOpenUrlExecutor implements ActionExecutorPort {
  constructor(private readonly openUrl: OpenUrlFn) {}

  async execute(action: Action, target: string): Promise<ActionExecutionStatus> {
    if (action.kind !== "open_url") {
      return {
        state: "failure",
        target,
        message: "This action type is not supported."
      };
    }

    const validated = validateOpenUrl(action.url);
    if (!validated.ok) {
      return {
        state: "failure",
        target,
        message: validated.error.message
      };
    }

    try {
      const opened = await this.openUrl(validated.value);
      if (!opened) {
        return {
          state: "failure",
          target,
          message: "The operating system did not accept the URL."
        };
      }
      return {
        state: "success",
        target,
        message: `Opened URL: ${validated.value}`
      };
    } catch {
      return {
        state: "failure",
        target,
        message: "The operating system could not open the URL."
      };
    }
  }
}
