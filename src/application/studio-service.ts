import type { PageConfig } from "../domain/profile";
import type { CoreEvent, CorePort, VirtualInput } from "./ports/core-port";

export class StudioService {
  constructor(private readonly core: CorePort) {}

  subscribe(listener: (event: CoreEvent) => void) {
    return this.core.subscribe(listener);
  }

  getConnectionStatus() {
    return this.core.getConnectionStatus();
  }

  getSnapshot() {
    return this.core.getSnapshot();
  }

  getDeviceLayout() {
    return this.core.getDeviceLayout();
  }

  createProfile(name: string) {
    return this.core.createProfile(name);
  }

  renameProfile(profileId: string, name: string) {
    return this.core.renameProfile(profileId, name);
  }

  activateProfile(profileId: string) {
    return this.core.activateProfile(profileId);
  }

  savePage(profileId: string, page: PageConfig) {
    return this.core.savePage(profileId, page);
  }

  sendVirtualInput(input: VirtualInput) {
    return this.core.sendVirtualInput(input);
  }

  simulateDisconnect() {
    return this.core.simulateDisconnect();
  }

  simulateReconnect() {
    return this.core.simulateReconnect();
  }

  close() {
    return this.core.close();
  }
}
