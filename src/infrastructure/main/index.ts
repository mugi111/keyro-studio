import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/bun";
import { StudioService } from "../../application/studio-service";
import { createCoreAdapter, readCoreAdapterConfig } from "./core-adapter-factory";
import { registerAppLifecycle } from "./app-lifecycle";
import { createStudioRPC } from "./rpc-handlers";
import { studioNavigationRules, studioViewUrl, studioWindowSecurityPolicy } from "./window-policy";

const service = new StudioService(createCoreAdapter(readCoreAdapterConfig(), { openUrl: (url) => Utils.openExternal(url) }));
const rpc = createStudioRPC(service);

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }]
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "delete" },
      { role: "selectAll" }
    ]
  }
]);

const mainWindow = new BrowserWindow({
  title: "Keyro Studio",
  url: studioViewUrl,
  frame: { x: 120, y: 120, width: 1180, height: 820 },
  rpc,
  sandbox: studioWindowSecurityPolicy.sandbox,
  navigationRules: JSON.stringify(studioNavigationRules)
});

mainWindow.webview.setNavigationRules([...studioNavigationRules]);

registerAppLifecycle(service, () => Utils.quit());
