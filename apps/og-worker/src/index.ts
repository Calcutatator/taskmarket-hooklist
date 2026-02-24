const BOT_PATTERNS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot-LinkExpanding',
  'WhatsApp',
  'Telegram',
  'Discordbot',
  'Applebot',
  'Googlebot',
  'bingbot',
];

const API_HOST = 'api-market.daydreams.systems';

function isSocialBot(ua: string): boolean {
  return BOT_PATTERNS.some((p) => ua.includes(p));
}

export default {
  async fetch(request: Request): Promise<Response> {
    const ua = request.headers.get('user-agent') ?? '';

    if (isSocialBot(ua)) {
      const url = new URL(request.url);
      // Only proxy page requests — let static assets (images, js, css) pass through
      // so the bot can fetch og-image.png from the frontend origin directly.
      const hasFileExtension = /\.\w+$/.test(url.pathname);
      if (!hasFileExtension) {
        url.hostname = API_HOST;
        return fetch(url.toString(), {
          method: request.method,
          headers: request.headers,
        });
      }
    }

    return fetch(request);
  },
} satisfies ExportedHandler;
