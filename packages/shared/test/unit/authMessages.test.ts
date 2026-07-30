// Verifies: ADR-0020 (normalize wallet addresses to lowercase)
import { describe, it, expect } from 'vitest';
import {
  buildSelectWorkerMessage,
  buildReadAuthMessage,
  buildSubmitMessage,
  buildClaimMessage,
  buildForfeitMessage,
  buildSetWithdrawalAddressMessage,
  buildWithdrawDreamsMessage,
  buildDeviceRegisterMessage,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '../../src/lib/authMessages.js';

const CHECKSUMMED = '0xAbC0000000000000000000000000000000000123';
const LOWER = '0xabc0000000000000000000000000000000000123';

describe('buildSelectWorkerMessage', () => {
  it('joins taskId, pitchId and the lowercased worker address', () => {
    expect(buildSelectWorkerMessage('task1', 'pitch1', CHECKSUMMED)).toBe(
      `taskmarket:select-worker:task1:pitch1:${LOWER}`
    );
  });
});

describe('buildReadAuthMessage', () => {
  it('lowercases the address', () => {
    expect(buildReadAuthMessage(CHECKSUMMED)).toBe(`taskmarket:read:${LOWER}`);
  });
});

describe('task-scoped messages', () => {
  it('build submit/claim/forfeit messages bound to the taskId', () => {
    expect(buildSubmitMessage('t42')).toBe('taskmarket:submit:t42');
    expect(buildClaimMessage('t42')).toBe('taskmarket:claim:t42');
    expect(buildForfeitMessage('t42')).toBe('taskmarket:forfeit:t42');
  });
});

describe('buildSubmitMessage content bindings', () => {
  it('omits the bindings segment entirely when contentBindings is not passed', () => {
    expect(buildSubmitMessage('t42')).toBe('taskmarket:submit:t42');
  });

  it('appends a comma-joined bindings segment when contentBindings is passed', () => {
    expect(buildSubmitMessage('t42', ['keyA', 'keyB'])).toBe('taskmarket:submit:t42:keyA,keyB');
  });

  it('appends a single binding without a trailing comma', () => {
    expect(buildSubmitMessage('t42', ['onlyKey'])).toBe('taskmarket:submit:t42:onlyKey');
  });
});

describe('buildSetWithdrawalAddressMessage', () => {
  it('lowercases the withdrawal address', () => {
    expect(buildSetWithdrawalAddressMessage(CHECKSUMMED)).toBe(
      `taskmarket:set-withdrawal-address:${LOWER}`
    );
  });
});

describe('buildWithdrawDreamsMessage', () => {
  it('lowercases only the destination and preserves nonce and validBefore', () => {
    expect(buildWithdrawDreamsMessage(CHECKSUMMED, '7', '1700000000')).toBe(
      `taskmarket:withdraw-dreams:${LOWER}:7:1700000000`
    );
  });
});

describe('buildDeviceRegisterMessage', () => {
  it('lowercases the wallet address', () => {
    expect(buildDeviceRegisterMessage(CHECKSUMMED)).toBe(`taskmarket:device-register:${LOWER}`);
  });
});

describe('read-auth header constants', () => {
  it('exposes the expected header names', () => {
    expect(READ_AUTH_ADDRESS_HEADER).toBe('X-Taskmarket-Caller-Address');
    expect(READ_AUTH_SIGNATURE_HEADER).toBe('X-Taskmarket-Caller-Signature');
  });
});
