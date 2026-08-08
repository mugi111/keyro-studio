import { BrowserView } from "electrobun/bun";
import { ok } from "../../shared/result";
import type { StudioService } from "../../application/studio-service";
import type { StudioRPC } from "../rpc/electrobun-rpc-contract";
import type { PageConfig } from "../../domain/profile";
import type { VirtualInput } from "../../application/ports/core-port";

export function createStudioRPC(service: StudioService) {
  const rpc = BrowserView.defineRPC<StudioRPC>({
    handlers: {
      requests: {
        getConnectionStatus: () => service.getConnectionStatus(),
        getSnapshot: () => service.getSnapshot(),
        getDeviceLayout: () => service.getDeviceLayout(),
        createProfile: async ({ name }: { name: string }) => {
          const created = await service.createProfile(name);
          if (!created.ok) return created;
          return service.getSnapshot();
        },
        renameProfile: async ({ profileId, name }: { profileId: string; name: string }) => {
          const renamed = await service.renameProfile(profileId, name);
          if (!renamed.ok) return renamed;
          return service.getSnapshot();
        },
        activateProfile: ({ profileId }: { profileId: string }) => service.activateProfile(profileId),
        savePage: ({ profileId, page }: { profileId: string; page: PageConfig }) => service.savePage(profileId, page),
        sendVirtualInput: ({ input }: { input: VirtualInput }) => service.sendVirtualInput(input),
        simulateDisconnect: () => service.simulateDisconnect(),
        simulateReconnect: () => service.simulateReconnect()
      },
      messages: {
        uiReady: () => {
          service.getConnectionStatus().then((status) => {
            rpc.send.coreEvent({ type: "connection", status });
          });
          service.getSnapshot().then((snapshot) => {
            if (snapshot.ok) rpc.send.coreEvent({ type: "snapshot", snapshot: snapshot.value });
          });
        }
      }
    }
  });

  service.subscribe((event) => {
    rpc.send.coreEvent(event);
  });

  return rpc;
}

export function rpcContractSmokeResult() {
  return ok("studio-rpc-ready");
}
