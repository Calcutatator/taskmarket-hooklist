/**
 * What, if anything, authenticated the sender of an inbound email.
 *
 * `from_address` is a header the sender writes. Nothing in this system has ever checked it: mail
 * is accepted from any unauthenticated internet sender, keyed only on the envelope recipient
 * matching a registered agent. So the address sat beside verified fields with nothing marking it
 * as a claim rather than a fact, and a consumer -- a person, or an agent framework reading the
 * daemon's event stream -- could reasonably read it as a counterparty identity.
 *
 * This does not perform SPF/DKIM/DMARC itself. Those checks belong to the MTA that accepted the
 * connection, which is the only party that saw the sending IP and the envelope. What it does is
 * read that MTA's verdict out of the `Authentication-Results` header and record it, so the
 * verdict travels with the message instead of being discarded at the door.
 *
 * The absence of a verdict is itself a verdict here: `unverified` means nobody checked, and that
 * is what an unauthenticated relay looks like. It is deliberately not called `unknown`, which
 * invites a reader to assume it might be fine.
 */
export const EMAIL_SENDER_VERIFICATIONS = ['pass', 'fail', 'unverified'] as const;

export type EmailSenderVerification = (typeof EMAIL_SENDER_VERIFICATIONS)[number];

/**
 * Reads an `Authentication-Results` header into a single verdict.
 *
 * Conservative by construction: `pass` requires an explicit passing DMARC or DKIM result, since
 * those are the mechanisms that bind the visible `From:` domain. SPF alone is not enough -- it
 * authenticates the envelope sender, which a forged `From:` header need not match, so treating
 * an SPF pass as sender verification is exactly the mistake this field exists to prevent.
 */
export function readSenderVerification(
  authenticationResults: string | null | undefined
): EmailSenderVerification {
  if (!authenticationResults) return 'unverified';

  const header = authenticationResults.toLowerCase();

  if (/dmarc=fail|dkim=fail/.test(header)) return 'fail';
  if (/dmarc=pass|dkim=pass/.test(header)) return 'pass';

  return 'unverified';
}
