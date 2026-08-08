import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/bun";
import { StudioService } from "../../application/studio-service";
import { createCoreAdapter, readCoreAdapterConfig } from "./core-adapter-factory";
import { registerAppLifecycle } from "./app-lifecycle";
import { createStudioRPC } from "./rpc-handlers";

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
  url: "views://studio/index.html",
  frame: { x: 120, y: 120, width: 1180, height: 820 },
  rpc,
  sandbox: false,
  navigationRules: JSON.stringify(["views://studio/*"])
});

mainWindow.webview.setNavigationRules(["views://studio/*"]);

registerAppLifecycle(service, () => Utils.quit());
