import { and, eq } from 'drizzle-orm';
import { agentXmtpPeerPolicies } from '../db/schema';
import { getServerConfig } from '../config/env';
import { lowerColumnEq } from '../lib/agents';
import type { Context } from '../context';

export type PeerPolicy = 'allow' | 'deny' | 'quarantine';
type Db = Context['db'];

export function getPolicyMode(): 'allowlist' | 'open' {
  return getServerConfig().XMTP_POLICY_DEFAULT;
}

export async function resolveEffectivePeerPolicy(
  db: Db,
  ownerAgentAddress: string,
  peerInboxId: string
): Promise<PeerPolicy> {
  const rows = await db
    .select({ policy: agentXmtpPeerPolicies.policy })
    .from(agentXmtpPeerPolicies)
    .where(
      and(
        lowerColumnEq(agentXmtpPeerPolicies.ownerAgentAddress, ownerAgentAddress),
        eq(agentXmtpPeerPolicies.peerInboxId, peerInboxId)
      )
    )
    .limit(1);

  const policy = rows[0]?.policy as PeerPolicy | undefined;
  if (policy) {
    return policy;
  }

  return getPolicyMode() === 'open' ? 'allow' : 'deny';
}
