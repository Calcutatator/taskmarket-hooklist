interface Env {
  BACKEND_URL: string;
  EMAIL_WEBHOOK_SECRET: string;
  EMAIL_DOMAIN: string;
  RESEND_API_KEY: string;
}

interface SendEmailBody {
  bodyHtml?: string;
  bodyText?: string;
  from?: string;
  idempotencyKey?: string;
  subject?: string;
  tags?: Array<{ name: string; value: string }>;
  to?: string;
}

function isTagArray(value: unknown): value is Array<{ name: string; value: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (tag) =>
        typeof tag === 'object' &&
        tag !== null &&
        typeof (tag as { name?: unknown }).name === 'string' &&
        typeof (tag as { value?: unknown }).value === 'string'
    )
  );
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

    let body: SendEmailBody;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { bodyHtml, bodyText, from, idempotencyKey, subject, tags, to } = body;
    if (!from || !to || !subject || (!bodyText && !bodyHtml)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Missing required fields: from, to, subject, and bodyText or bodyHtml',
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

    if (tags !== undefined && !isTagArray(tags)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid tags' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resendBody: Record<string, unknown> = { from, subject, to };
    if (bodyHtml) {
      resendBody.html = bodyHtml;
    }
    if (bodyText) {
      resendBody.text = bodyText;
    }
    if (tags) {
      resendBody.tags = tags;
    }

    const resendHeaders: Record<string, string> = {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    };
    if (idempotencyKey) {
      resendHeaders['Idempotency-Key'] = idempotencyKey;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: resendHeaders,
      body: JSON.stringify(resendBody),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, error: `Resend error: ${err}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
