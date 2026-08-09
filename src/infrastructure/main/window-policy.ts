export const studioViewUrl = "views://studio/index.html";
export const studioNavigationRules = ["views://studio/*"] as const;

export const studioWindowSecurityPolicy = {
  sandbox: false,
  reason:
    "Electrobun disables the typed Bun RPC bridge in sandboxed windows; Studio limits capability with local views-only navigation, CSP, and a minimal typed API."
} as const;
