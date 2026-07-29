export function isWebKitRscPrefetchAccessControlError(projectName: string, text: string) {
  return (
    projectName.includes('webkit') &&
    text.includes('_rsc=') &&
    text.includes('due to access control checks.')
  );
}
