import { getServerConfig } from '../config/env';

export function isOfficialTaskDropOwner(ownerAddress: string): boolean {
  const normalizedOwner = ownerAddress.toLowerCase();
  return (getServerConfig().OFFICIAL_TASK_DROP_OWNER_ADDRESSES ?? []).includes(normalizedOwner);
}
