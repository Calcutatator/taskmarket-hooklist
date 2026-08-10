import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { generateOpenAPI } = await import('../../../src/lib/openapi');

afterAll(restoreServerEnvironment);

describe('generated OpenAPI routes', () => {
  it.each([
    ['/tasks/{taskId}/pitches', 'get'],
    ['/tasks/{taskId}/proofs', 'get'],
    ['/tasks/{taskId}/evaluate', 'post'],
    ['/tasks/{taskId}/appeal', 'post'],
    ['/tasks/{taskId}/resolve-dispute', 'post'],
    ['/tasks/{taskId}/evaluator-timeout', 'post'],
    ['/tasks/{taskId}/finalize-verdict', 'post'],
    ['/legal/current', 'get'],
    ['/legal/status', 'get'],
    ['/legal/challenge', 'post'],
    ['/legal/accept/wallet', 'post'],
    ['/legal/accept/web', 'post'],
  ])('exposes %s %s', (path, method) => {
    const document = generateOpenAPI();
    expect(document.paths?.[path]?.[method as 'get' | 'post']).toBeDefined();
  });

  // Verifies: ADR-0052
  it.each([
    ['/tasks', 'post'],
    ['/tasks/{taskId}/claim', 'post'],
    ['/tasks/{taskId}/evaluate', 'post'],
    ['/identity/register', 'post'],
  ])('documents the mandatory idempotency header on %s %s', (path, method) => {
    // The header is enforced ahead of the 402 challenge and a request without it is a 400
    // (ADR-0052). While the spec omitted it, a raw-REST caller reading the machine-readable
    // contract saw no such requirement, sent no such header, and got a rejection with nothing
    // in the document explaining it. A breaking change absent from the contract is
    // indistinguishable from a broken endpoint.
    const document = generateOpenAPI();
    const operation = document.paths?.[path]?.[method as 'get' | 'post'] as
      | { parameters?: { in: string; name: string; required?: boolean }[] }
      | undefined;

    const header = operation?.parameters?.find(
      (parameter) =>
        parameter.in === 'header' && parameter.name === 'X-Taskmarket-Idempotency-Key'
    );

    expect(header, `${method.toUpperCase()} ${path} does not document the header`).toBeDefined();
    expect(header?.required).toBe(true);
  });

  it('exposes Task Drop paths without transform-only response schemas', () => {
    const document = generateOpenAPI();

    expect(document.paths?.['/task-drops']).toBeDefined();
    expect(document.paths?.['/task-drops/{taskDropId}']).toBeDefined();
    expect(document.paths?.['/task-drops/official/subscribe']?.post).toBeDefined();
    expect(document.paths?.['/task-drops/official/status']?.get).toBeDefined();
    expect(document.paths?.['/task-drops/{taskDropId}/announce']?.post).toBeDefined();
  });
});
