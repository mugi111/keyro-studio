import type { Action } from "../../domain/action";
import type { Profile, StudioSnapshot } from "../../domain/profile";
import type { ActionExecutionStatus, ActionExecutionTarget } from "../../application/ports/action-executor-port";
import type { VirtualInput } from "../../application/ports/core-port";

export const KEYRO_PROTOCOL_VERSION = "0.2.0" as const;

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export const keyroProtocolVersion: ProtocolVersion = {
  major: 0,
  minor: 2
};

export interface ClientEnvelope {
  request_id: string;
  message: ClientMessage;
}

export type ClientMessage =
  | HandshakeMessage
  | GetSnapshotMessage
  | ListProfilesMessage
  | SetActiveProfileMessage
  | SaveAssignmentMessage
  | VirtualControlInputMessage;

export interface HandshakeMessage {
  type: "handshake";
  component: "studio";
  component_version: string;
  protocol: ProtocolVersion;
}

export interface GetSnapshotMessage {
  type: "get_snapshot";
}

export interface ListProfilesMessage {
  type: "list_profiles";
}

export interface SetActiveProfileMessage {
  type: "set_active_profile";
  profile_id: string;
}

export interface SaveAssignmentMessage {
  type: "save_assignment";
  assignment: AssignmentDto;
}

export interface VirtualControlInputMessage {
  type: "virtual_control_input";
  control: ControlDto;
}

export interface AssignmentDto {
  profile_id: string;
  control: ControlDto;
  action: ActionDto;
}

export type ControlDto =
  | { kind: "key"; page: number; key: number }
  | {
      kind: "encoder";
      page: number;
      encoder: number;
      operation: EncoderOperationDto;
    };

export type EncoderOperationDto = "left" | "right" | "press";

export type ActionDto = {
  kind: "open_url";
  url: string;
};

export type ServerMessage =
  | HandshakeAcceptedMessage
  | SnapshotMessage
  | ProfilesMessage
  | AcknowledgedMessage
  | ActionEventMessage
  | ErrorMessage;

export interface HandshakeAcceptedMessage {
  type: "handshake_accepted";
  request_id: string;
  core_version: string;
  protocol: ProtocolVersion;
}

export interface SnapshotMessage {
  type: "snapshot";
  request_id: string;
  layout: DeviceLayoutDto;
  profiles: ProfileDto[];
  assignments: SnapshotAssignmentDto[];
}

export interface DeviceLayoutDto {
  page_count: number;
  key_rows: number;
  key_columns: number;
  encoder_count: number;
}

export interface SnapshotAssignmentDto {
  profile_id: string;
  control: ControlDto;
  actions: ActionDto[];
}

export interface ProfilesMessage {
  type: "profiles";
  request_id: string;
  profiles: ProfileDto[];
}

export interface AcknowledgedMessage {
  type: "acknowledged";
  request_id: string;
}

export interface ActionEventMessage {
  type: "action_event";
  event: ActionEventDto;
}

export interface ErrorMessage {
  type: "error";
  request_id: string | null;
  error: ErrorDto;
}

export interface ProfileDto {
  id: string;
  name: string;
  is_active: boolean;
}

export type ActionEventDto =
  | {
      state: "running";
      execution_id: string;
      profile_id: string;
      control: ControlDto;
    }
  | {
      state: "succeeded";
      execution_id: string;
    }
  | {
      state: "failed";
      execution_id: string;
      code: ActionFailureCode;
      message: string;
    };

export type ActionFailureCode = "open_url_failed" | "no_action_assigned" | "validation_failed" | "internal";

export interface ErrorDto {
  code: ErrorCode;
  message: string;
}

export type ErrorCode = "incompatible_protocol" | "unknown_message" | "validation_failed" | "internal";

export function createHandshakeMessage(componentVersion: string): HandshakeMessage {
  return {
    type: "handshake",
    component: "studio",
    component_version: componentVersion,
    protocol: keyroProtocolVersion
  };
}

export function createClientEnvelope(requestId: string, message: ClientMessage): ClientEnvelope {
  return {
    request_id: requestId,
    message
  };
}

export function profileToDto(profile: Profile): ProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    is_active: profile.active
  };
}

export function profilesToMessage(requestId: string, profiles: Profile[]): ProfilesMessage {
  return {
    type: "profiles",
    request_id: requestId,
    profiles: profiles.map(profileToDto)
  };
}

export function snapshotToMessage(requestId: string, snapshot: StudioSnapshot): SnapshotMessage {
  return {
    type: "snapshot",
    request_id: requestId,
    layout: {
      page_count: snapshot.layout.pageCount,
      key_rows: snapshot.layout.keyRows,
      key_columns: snapshot.layout.keyColumns,
      encoder_count: snapshot.layout.encoderCount
    },
    profiles: snapshot.profiles.map(profileToDto),
    assignments: snapshot.profiles.flatMap((profile) =>
      profile.pages.flatMap((page) => [
        ...page.keys.flatMap((key) =>
          key.action
            ? [
                {
                  profile_id: profile.id,
                  control: { kind: "key" as const, page: page.index, key: key.index },
                  actions: [actionDtoFromAction(key.action)]
                }
              ]
            : []
        ),
        ...page.encoders.flatMap((encoder) =>
          encoderAssignmentsFromActions(profile.id, page.index, encoder.index, [
            ["left", encoder.rotateLeft],
            ["right", encoder.rotateRight],
            ["press", encoder.press]
          ])
        )
      ])
    )
  };
}

function encoderAssignmentsFromActions(
  profileId: string,
  pageIndex: number,
  encoderIndex: number,
  entries: Array<[EncoderOperationDto, Action | null]>
): SnapshotAssignmentDto[] {
  return entries.flatMap(([operation, action]) =>
    action
      ? [
          {
            profile_id: profileId,
            control: {
              kind: "encoder" as const,
              page: pageIndex,
              encoder: encoderIndex,
              operation
            },
            actions: [actionDtoFromAction(action)]
          }
        ]
      : []
  );
}

export function controlDtoFromVirtualInput(input: VirtualInput): ControlDto {
  if (input.type === "key") {
    return {
      kind: "key",
      page: input.pageIndex,
      key: input.keyIndex
    };
  }
  return {
    kind: "encoder",
    page: input.pageIndex,
    encoder: input.encoderIndex,
    operation: encoderOperationFromInteraction(input.interaction)
  };
}

export function controlDtoFromActionTarget(target: ActionExecutionTarget): ControlDto {
  if (target.type === "key") {
    return {
      kind: "key",
      page: target.pageIndex,
      key: target.keyIndex
    };
  }
  return {
    kind: "encoder",
    page: target.pageIndex,
    encoder: target.encoderIndex,
    operation: encoderOperationFromInteraction(target.interaction)
  };
}

export function actionDtoFromAction(action: Action): ActionDto {
  return {
    kind: "open_url",
    url: action.url
  };
}

export function assignmentDtoFromAction(
  profileId: string,
  target: ActionExecutionTarget,
  action: Action
): AssignmentDto {
  return {
    profile_id: profileId,
    control: controlDtoFromActionTarget(target),
    action: actionDtoFromAction(action)
  };
}

export function actionEventDtoFromStatus(status: ActionExecutionStatus, executionId: string): ActionEventDto | null {
  if (status.state === "idle") return null;
  if (status.state === "running") {
    return {
      state: "running",
      execution_id: executionId,
      profile_id: status.target.profileId,
      control: controlDtoFromActionTarget(status.target)
    };
  }
  if (status.state === "success") {
    return {
      state: "succeeded",
      execution_id: executionId
    };
  }
  return {
    state: "failed",
    execution_id: executionId,
    code: status.code,
    message: status.message
  };
}

type EncoderInteraction = Extract<ActionExecutionTarget, { type: "encoder" }>["interaction"];

export function encoderOperationFromInteraction(interaction: EncoderInteraction): EncoderOperationDto {
  if (interaction === "rotateLeft") return "left";
  if (interaction === "rotateRight") return "right";
  return "press";
}

export function encoderInteractionFromOperation(operation: EncoderOperationDto): EncoderInteraction {
  if (operation === "left") return "rotateLeft";
  if (operation === "right") return "rotateRight";
  return "press";
}
