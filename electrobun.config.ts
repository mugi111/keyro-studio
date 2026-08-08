import type { ElectrobunConfig } from "electrobun";

export const config: ElectrobunConfig = {
  app: {
    name: "Keyro Studio",
    identifier: "dev.keyro.studio",
    version: "0.1.0"
  },
  build: {
    bun: {
      entrypoint: "src/infrastructure/main/index.ts"
    },
    views: {
      studio: {
        entrypoint: "src/ui/index.ts"
      }
    },
    copy: {
      "src/ui/index.html": "views/studio/index.html",
      "src/ui/styles.css": "views/studio/styles.css"
    },
    mac: {
      bundleCEF: false
    },
    linux: {
      bundleCEF: false
    },
    win: {
      bundleCEF: false
    },
  },
  runtime: {
    exitOnLastWindowClosed: true
  }
};

export default config;
