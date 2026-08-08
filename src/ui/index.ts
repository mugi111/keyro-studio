import { Electroview } from "electrobun/view";
import type { StudioRPC } from "../shared/electrobun-rpc-contract";
import { mountStudio, type StudioAPI } from "./dom";

const rpc = Electroview.defineRPC<StudioRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const electroview = new Electroview({ rpc });

const api: StudioAPI = {
  getConnectionStatus: () => electroview.rpc!.request.getConnectionStatus(),
  getSnapshot: () => electroview.rpc!.request.getSnapshot(),
  createProfile: (name) => electroview.rpc!.request.createProfile({ name }),
  renameProfile: (profileId, name) => electroview.rpc!.request.renameProfile({ profileId, name }),
  activateProfile: (profileId) => electroview.rpc!.request.activateProfile({ profileId }),
  savePage: (profileId, page) => electroview.rpc!.request.savePage({ profileId, page }),
  sendVirtualInput: (input) => electroview.rpc!.request.sendVirtualInput({ input }),
  simulateDisconnect: () => electroview.rpc!.request.simulateDisconnect(),
  simulateReconnect: () => electroview.rpc!.request.simulateReconnect(),
  onCoreEvent: (listener) => {
    electroview.rpc!.addMessageListener("coreEvent", listener);
  },
  ready: () => {
    electroview.rpc!.send.uiReady({ at: Date.now() });
  }
};

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app root.");
}

mountStudio(root, api);
