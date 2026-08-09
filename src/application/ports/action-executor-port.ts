import type { Action } from "../../domain/action";

export type ActionExecutionTarget =
  | { type: "key"; profileId: string; pageIndex: number; keyIndex: number }
  | {
      type: "encoder";
      profileId: string;
      pageIndex: number;
      encoderIndex: number;
      interaction: "rotateLeft" | "rotateRight" | "press";
    };

export type ActionExecutionFailureCode = "open_url_failed" | "no_action_assigned" | "validation_failed" | "internal";

export type ActionExecutionStatus =
  | { state: "idle" }
  | { state: "running"; target: ActionExecutionTarget }
  | { state: "success"; target: ActionExecutionTarget; message: string }
  | { state: "failure"; target: ActionExecutionTarget; code: ActionExecutionFailureCode; message: string };

export interface ActionExecutorPort {
  execute(action: Action, target: ActionExecutionTarget): Promise<ActionExecutionStatus>;
}
