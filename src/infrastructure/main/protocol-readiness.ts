export const protocolPackageName = "@keyro/protocol";
export const plannedCoreStudioProtocolTag = "v0.1.0";

export function protocolPackageUnavailableReason(): string {
  return `Keyro Core local IPC requires transport bindings, schemas, and test vectors for ${protocolPackageName} ${plannedCoreStudioProtocolTag}. Studio now carries the temporary TypeScript contract at the adapter boundary.`;
}
