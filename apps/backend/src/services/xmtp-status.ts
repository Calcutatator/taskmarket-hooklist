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
  return db
    .select({
      installationId: agentXmtpInstallations.installationId,
      status: agentXmtpInstallations.status,
      lastSeenAt: agentXmtpInstallations.lastSeenAt,
    })
    .from(agentXmtpInstallations)
    .where(eq(agentXmtpInstallations.agentAddress, agentAddress));
}

export async function heartbeatInstallation(db: Db, installationId: string): Promise<void> {
  await db
    .update(agentXmtpInstallations)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(agentXmtpInstallations.installationId, installationId),
        eq(agentXmtpInstallations.status, 'active')
      )
    );
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
