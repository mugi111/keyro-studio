import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";
import type { StudioEvents, StudioMessages, StudioRequests } from "../../application/studio-api-contract";

export type StudioBunRPC = RPCSchema<{
  requests: StudioRequests;
  messages: StudioMessages;
}>;

export type StudioWebviewRPC = RPCSchema<{
  requests: {};
  messages: StudioEvents;
}>;

export interface StudioRPC extends ElectrobunRPCSchema {
  bun: StudioBunRPC;
  webview: StudioWebviewRPC;
}
