// Implements: ADR-0092
import type { X402PaymentRecord } from './x402-journal.js';

export class ExternalX402Error extends Error {
  readonly payment?: X402PaymentRecord;
  readonly pending?: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      payment?: X402PaymentRecord;
      pending?: boolean;
      status?: number;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExternalX402Error';
    this.payment = options.payment;
    this.pending = options.pending;
    this.status = options.status;
  }
}
