import type { ActionExecutorPort, ActionExecutionStatus } from "../../application/ports/action-executor-port";
import type { Action } from "../../domain/action";

export class MockActionExecutor implements ActionExecutorPort {
  async execute(action: Action, target: string): Promise<ActionExecutionStatus> {
    if (action.kind === "open_url" && action.url.includes("fail")) {
      return {
        state: "failure",
        target,
        message: "Mock action executor refused this URL. Remove 'fail' from the URL and try again."
      };
    }

    return {
      state: "success",
      target,
      message: `${action.kind} accepted: ${action.url}`
    };
  }
}
