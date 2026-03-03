import { and, eq, isNull, lt } from 'drizzle-orm';
import { agentXmtpInstallations } from '../db/schema';
import type { Context } from '../context';

type Db = Context['db'];

export interface InstallationStatusRow {
  installationId: string;
  status: string;
  lastSeenAt: Date;
}

export async function listAgentInstallations(
  db: Db,
  agentAddress: string
): Promise<InstallationStatusRow[]> {
  const rows = await db
    .select({
      installationId: agentXmtpInstallations.installationId,
      status: agentXmtpInstallations.status,
      lastSeenAt: agentXmtpInstallations.lastSeenAt,
      revokedAt: agentXmtpInstallations.revokedAt,
    })
    .from(agentXmtpInstallations)
    .where(eq(agentXmtpInstallations.agentAddress, agentAddress));

  return rows
    .filter((row) => row.status === 'active' && row.revokedAt == null)
    .map((row) => ({
      installationId: row.installationId,
      status: row.status,
      lastSeenAt: row.lastSeenAt,
    }));
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

export async function findStaleInstallations(db: Db, staleBefore: Date) {
  return db
    .select()
    .from(agentXmtpInstallations)
    .where(
      and(
        eq(agentXmtpInstallations.status, 'active'),
        isNull(agentXmtpInstallations.revokedAt),
        lt(agentXmtpInstallations.lastSeenAt, staleBefore)
      )
    );
}
