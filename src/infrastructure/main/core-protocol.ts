import {
  KEYRO_PROTOCOL_HANDSHAKE_VERSION,
  KEYRO_PROTOCOL_VERSION
} from "@mugi111/keyro-protocol/core-studio/v0.2.0";
import type { Action } from "../../domain/action";
import type { Profile, StudioSnapshot } from "../../domain/profile";
import type { ActionExecutionStatus, ActionExecutionTarget } from "../../application/ports/action-executor-port";
import type { VirtualInput } from "../../application/ports/core-port";
import type {
  ActionDto,
  ActionEventDto,
  ActionFailureCode,
  AssignmentDto,
  ClientEnvelope,
  ClientMessage,
  ControlDto,
  DeviceLayoutDto,
  EncoderOperationDto,
  ErrorCode,
  ErrorMessage,
  HandshakeMessage,
  ProfileDto,
  ProfilesMessage,
  ProtocolVersion,
  ServerMessage,
  SnapshotAssignmentDto,
  SnapshotMessage
} from "@mugi111/keyro-protocol/core-studio/v0.2.0";

export { KEYRO_PROTOCOL_VERSION };
export type {
  ActionDto,
  ActionEventDto,
  ActionFailureCode,
  AssignmentDto,
  ClientEnvelope,
  ClientMessage,
  ControlDto,
  DeviceLayoutDto,
  EncoderOperationDto,
  ErrorCode,
  ErrorMessage,
  HandshakeMessage,
  ProfileDto,
  ProfilesMessage,
  ProtocolVersion,
  ServerMessage,
  SnapshotAssignmentDto,
  SnapshotMessage
};

export const keyroProtocolVersion: ProtocolVersion = KEYRO_PROTOCOL_HANDSHAKE_VERSION;

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
