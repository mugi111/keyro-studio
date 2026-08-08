import type { ElectrobunRPCSchema, RPCSchema } from "electrobun";
import type { StudioEvents, StudioMessages, StudioRequests } from "../application/studio-api-contract";

type StudioBunRPC = RPCSchema<{
  requests: StudioRequests;
  messages: StudioMessages;
}>;

type StudioWebviewRPC = RPCSchema<{
  requests: {};
  messages: StudioEvents;
}>;

export interface StudioWebviewElectrobunRPC extends ElectrobunRPCSchema {
  bun: StudioBunRPC;
  webview: StudioWebviewRPC;
}
