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
  ])('exposes %s %s', (path, method) => {
    const document = generateOpenAPI();
    expect(document.paths?.[path]?.[method as 'get' | 'post']).toBeDefined();
  });

  it('exposes Task Drop paths without transform-only response schemas', () => {
    const document = generateOpenAPI();

    expect(document.paths?.['/task-drops']).toBeDefined();
    expect(document.paths?.['/task-drops/{taskDropId}']).toBeDefined();
  });
});
