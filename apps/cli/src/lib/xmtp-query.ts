import type { AgentMessageEnvelope } from '@taskmarket/shared';

interface PendingQuery {
  resolve: (value: AgentMessageEnvelope) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

export class XmtpQueryManager {
  private readonly pending = new Map<string, PendingQuery>();

  waitForResponse(requestId: string, timeoutMs: number): Promise<AgentMessageEnvelope> {
    return new Promise<AgentMessageEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`XMTP query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout });
    });
  }

  resolveResponse(envelope: AgentMessageEnvelope): boolean {
    if (!envelope.replyToRequestId) {
      return false;
    }

    const match = this.pending.get(envelope.replyToRequestId);
    if (!match) {
      return false;
    }

    clearTimeout(match.timeout);
    this.pending.delete(envelope.replyToRequestId);
    match.resolve(envelope);
    return true;
  }

  clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('XMTP query manager cleared'));
    }
    this.pending.clear();
  }

  size(): number {
    return this.pending.size;
  }
}
