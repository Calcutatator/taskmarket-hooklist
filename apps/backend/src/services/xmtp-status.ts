import { and, eq, isNull, lt } from 'drizzle-orm';
import { agentXmtpInstallations } from '../db/schema';
import type { Context } from '../context';

type Db = Context['db'];

export interface InstallationStatusRow {
  installationId: string;
  status: string;
  lastSeenAt: Date;
}

/**
 * An XMTP "installation" is one XMTP client keypair registered on one device.
 * This is XMTP's own term of art from @xmtp/node-sdk.
 *
 * A single agent wallet can have multiple installations — one per machine
 * the agent has ever run on (laptop, prod server, etc.). Each installation
 * has its own private key and local SQLite DB, but all share the same inboxId.
 * XMTP delivers messages to all active installations for a given inboxId.
 *
 * Installations are kept alive by periodic heartbeats. Those that exceed
 * XMTP_STALE_INSTALLATION_MINUTES without a heartbeat can be purged (revoked),
 * preventing message delivery to abandoned/decommissioned machines.
 */
export async function listAgentInstallations(
  db: Db,
  agentAddress: string
): Promise<InstallationStatusRow[]> {
  return db
    .select({
      installationId: agentXmtpInstallations.installationId,
      status: agentXmtpInstallations.status,
      lastSeenAt: agentXmtpInstallations.lastSeenAt,
    })
    .from(agentXmtpInstallations)
    .where(
      and(
        eq(agentXmtpInstallations.agentAddress, agentAddress),
        eq(agentXmtpInstallations.status, 'active'),
        isNull(agentXmtpInstallations.revokedAt)
      )
    );
}

export async function heartbeatInstallation(
  db: Db,
  input: {
    installationId: string;
    deviceId: string;
    agentAddress: string;
  }
): Promise<boolean> {
  const rows = await db
    .update(agentXmtpInstallations)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(agentXmtpInstallations.installationId, input.installationId),
        eq(agentXmtpInstallations.deviceId, input.deviceId),
        eq(agentXmtpInstallations.agentAddress, input.agentAddress),
        eq(agentXmtpInstallations.status, 'active'),
        isNull(agentXmtpInstallations.revokedAt)
      )
    )
    .returning({ installationId: agentXmtpInstallations.installationId });

  return rows.length > 0;
}

export async function findStaleInstallations(db: Db, staleBefore: Date, agentAddress?: string) {
  return db
    .select()
    .from(agentXmtpInstallations)
    .where(
      and(
        eq(agentXmtpInstallations.status, 'active'),
        isNull(agentXmtpInstallations.revokedAt),
        lt(agentXmtpInstallations.lastSeenAt, staleBefore),
        agentAddress ? eq(agentXmtpInstallations.agentAddress, agentAddress) : undefined
      )
    );
}
