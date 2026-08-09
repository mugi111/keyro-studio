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

export type ActionExecutionStatus =
  | { state: "idle" }
  | { state: "running"; target: ActionExecutionTarget }
  | { state: "success"; target: ActionExecutionTarget; message: string }
  | { state: "failure"; target: ActionExecutionTarget; message: string };

export interface ActionExecutorPort {
  execute(action: Action, target: ActionExecutionTarget): Promise<ActionExecutionStatus>;
}
