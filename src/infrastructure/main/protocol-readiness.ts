export const protocolPackageName = "@keyro/protocol";
export const plannedCoreStudioProtocolTag = "v0.1.0";

export function protocolPackageUnavailableReason(): string {
  return `Keyro Core local IPC requires ${protocolPackageName} ${plannedCoreStudioProtocolTag} generated TypeScript types, schemas, and test vectors.`;
}
