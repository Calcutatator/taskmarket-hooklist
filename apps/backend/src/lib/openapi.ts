import { generateOpenApiDocument } from 'trpc-to-openapi';
import { CANONICAL_PREIMAGE_ROUTES, expressPathToOpenApiPath } from '../config/routes';
import { appRouter } from '../router';

function pathParameter(name: string) {
  return {
    in: 'path' as const,
    name,
    required: true,
    schema: { type: 'string' as const },
  };
}

const canonicalPreimagePaths = {
  [expressPathToOpenApiPath(CANONICAL_PREIMAGE_ROUTES.submissionManifest)]: {
    get: {
      operationId: 'tasks.submissionManifest',
      summary: 'Get the canonical artifact manifest preimage',
      tags: ['Tasks'],
      parameters: [pathParameter('taskId'), pathParameter('submissionId')],
      responses: {
        200: {
          description: 'Canonical JSON bytes hashed for the submission',
          content: {
            'application/json': {
              schema: { type: 'object' as const, additionalProperties: true },
            },
          },
        },
        404: { description: 'Submission or artifacts not found' },
      },
    },
  },
  [expressPathToOpenApiPath(CANONICAL_PREIMAGE_ROUTES.pitchPreimage)]: {
    get: {
      operationId: 'tasks.pitchPreimage',
      summary: 'Get the canonical pitch hash preimage',
      tags: ['Tasks'],
      parameters: [pathParameter('taskId'), pathParameter('pitchId')],
      responses: {
        200: {
          description: 'Canonical ABI-encoded pitch preimage',
          content: {
            'text/plain': { schema: { type: 'string' as const } },
          },
        },
        404: { description: 'Pitch not found' },
        409: { description: 'Pitch has no onchain hash' },
      },
    },
  },
  [expressPathToOpenApiPath(CANONICAL_PREIMAGE_ROUTES.proofPreimage)]: {
    get: {
      operationId: 'tasks.proofPreimage',
      summary: 'Get the canonical proof hash preimage',
      tags: ['Tasks'],
      parameters: [pathParameter('taskId'), pathParameter('proofId')],
      responses: {
        200: {
          description: 'Canonical ABI-encoded proof preimage',
          content: {
            'text/plain': { schema: { type: 'string' as const } },
          },
        },
        404: { description: 'Proof not found' },
        409: { description: 'Proof has no onchain hash' },
      },
    },
  },
};

export function generateOpenAPI() {
  const document = generateOpenApiDocument(appRouter, {
    title: 'Taskmarket API',
    version: '1.0.0',
    baseUrl: 'http://localhost:3000/api',
    tags: ['Tasks', 'Health'],
  });
  const paths: typeof document.paths = {
    ...document.paths,
    ...canonicalPreimagePaths,
  };

  return {
    ...document,
    paths,
  };
}
