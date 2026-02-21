import { generateOpenApiDocument } from 'trpc-to-openapi';
import { appRouter } from '../router';

export function generateOpenAPI() {
  return generateOpenApiDocument(appRouter, {
    title: 'Taskmarket API',
    version: '1.0.0',
    baseUrl: 'http://localhost:3000/api',
    tags: ['Tasks', 'Health'],
  });
}
