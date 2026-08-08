import { ApplicationMenu, BrowserWindow, Utils } from "electrobun/bun";
import { createMockStudioService } from "./mock-core-adapter";
import { createStudioRPC } from "./rpc-handlers";

const service = createMockStudioService();
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

process.on("beforeExit", () => {
  service.close();
});

process.on("SIGINT", async () => {
  await service.close();
  Utils.quit();
});
