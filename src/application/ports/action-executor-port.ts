import type { Action } from "../../domain/action";

export type ActionExecutionStatus =
  | { state: "idle" }
  | { state: "running"; target: string }
  | { state: "success"; target: string; message: string }
  | { state: "failure"; target: string; message: string };

export interface ActionExecutorPort {
  execute(action: Action, target: string): Promise<ActionExecutionStatus>;
}
