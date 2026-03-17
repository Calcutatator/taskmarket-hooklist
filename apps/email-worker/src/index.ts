import { EmailMessage } from 'cloudflare:email';

interface Env {
  BACKEND_URL: string;
  EMAIL_WEBHOOK_SECRET: string;
  EMAIL_DOMAIN: string;
  EMAIL: { send(message: EmailMessage): Promise<void> };
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const rawResponse = new Response(message.raw);
    const rawBytes = await rawResponse.arrayBuffer();

    const response = await fetch(`${env.BACKEND_URL}/email/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Webhook-Secret': env.EMAIL_WEBHOOK_SECRET,
        'X-Email-From': message.from,
        'X-Email-To': message.to,
      },
      body: rawBytes,
    });

    if (!response.ok) {
      throw new Error(`Backend rejected inbound email: ${response.status} ${response.statusText}`);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/send') {
      return new Response('Not Found', { status: 404 });
    }

    const secret = request.headers.get('X-Webhook-Secret');
    if (secret !== env.EMAIL_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body: { from?: string; to?: string; subject?: string; bodyText?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { from, to, subject, bodyText } = body;
    if (!from || !to || !subject || !bodyText) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing required fields: from, to, subject, bodyText',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!from.endsWith(`@${env.EMAIL_DOMAIN}`)) {
      return new Response(
        JSON.stringify({ ok: false, error: `from address must end with @${env.EMAIL_DOMAIN}` }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const messageId = `${crypto.randomUUID()}@${env.EMAIL_DOMAIN}`;
    const date = new Date().toUTCString();
    const raw = [
      `From: <${from}>`,
      `To: <${to}>`,
      `Subject: ${subject}`,
      `Message-ID: <${messageId}>`,
      `Date: ${date}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      bodyText,
    ].join('\r\n');

    const message = new EmailMessage(from, to, raw);
    await env.EMAIL.send(message);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
