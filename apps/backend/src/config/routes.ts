export const CANONICAL_PREIMAGE_ROUTES = {
  submissionManifest: '/api/tasks/:taskId/submissions/:submissionId/manifest',
  pitchPreimage: '/api/tasks/:taskId/pitches/:pitchId/preimage',
  proofPreimage: '/api/tasks/:taskId/proofs/:proofId/preimage',
} as const;

export function expressPathToDocumentedApiPath(expressPath: string): string {
  return expressPath.replace(/:([a-zA-Z][a-zA-Z0-9]*)/g, '{$1}');
}

export function expressPathToOpenApiPath(expressPath: string): string {
  return expressPathToDocumentedApiPath(expressPath).replace(/^\/api/, '');
}
