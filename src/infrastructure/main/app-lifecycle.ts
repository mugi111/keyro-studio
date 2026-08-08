import type { StudioService } from "../../application/studio-service";

export type QuitFn = () => void;

export function registerAppLifecycle(service: StudioService, quit: QuitFn, proc: NodeJS.Process = process): void {
  proc.on("beforeExit", () => {
    void service.close();
  });

  proc.on("SIGINT", async () => {
    await service.close();
    quit();
  });

  proc.on("SIGTERM", async () => {
    await service.close();
    quit();
  });
}
