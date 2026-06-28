const API_HOST = 'api.taskmarket.dev';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/skill.md') {
      return fetch(new Request('https://' + API_HOST + url.pathname + url.search, request));
    }

    return fetch(request);
  },
} satisfies ExportedHandler;
