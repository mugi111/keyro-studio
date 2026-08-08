import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";
import type { StudioEvents, StudioMessages, StudioRequests } from "../application/studio-api-contract";

export type StudioWebviewBunRPC = RPCSchema<{
  requests: StudioRequests;
  messages: StudioMessages;
}>;

export type StudioWebviewSideRPC = RPCSchema<{
  requests: {};
  messages: StudioEvents;
}>;

export interface StudioWebviewElectrobunRPC extends ElectrobunRPCSchema {
  bun: StudioWebviewBunRPC;
  webview: StudioWebviewSideRPC;
}
