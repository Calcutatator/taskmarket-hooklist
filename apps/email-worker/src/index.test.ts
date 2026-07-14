import { beforeEach, describe, expect, it, vi } from 'vitest';

import worker from './index';

const env = {
  BACKEND_URL: 'https://api.taskmarket.example',
  EMAIL_DOMAIN: 'mail.taskmarket.example',
  EMAIL_WEBHOOK_SECRET: 'test-webhook-secret',
  RESEND_API_KEY: 're_test_key',
};

describe('email worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards html, text, tags, and idempotency metadata to Resend', async () => {
    const resend = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', resend);
    const request = new Request('https://worker.taskmarket.example/send', {
      body: JSON.stringify({
        bodyHtml: '<strong>New task</strong>',
        bodyText: 'New task',
        from: 'noreply@mail.taskmarket.example',
        idempotencyKey: 'task-drop-drop-1-task-1-sub-1',
        subject: 'New task',
        tags: [{ name: 'source', value: 'task_drops' }],
        to: 'alice@example.com',
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': env.EMAIL_WEBHOOK_SECRET,
      },
      method: 'POST',
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(resend).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        body: JSON.stringify({
          from: 'noreply@mail.taskmarket.example',
          subject: 'New task',
          to: 'alice@example.com',
          html: '<strong>New task</strong>',
          text: 'New task',
          tags: [{ name: 'source', value: 'task_drops' }],
        }),
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
          'Idempotency-Key': 'task-drop-drop-1-task-1-sub-1',
        }),
      })
    );
  });

  it('rejects outbound requests with the wrong webhook secret', async () => {
    const resend = vi.fn();
    vi.stubGlobal('fetch', resend);
    const request = new Request('https://worker.taskmarket.example/send', {
      body: '{}',
      headers: { 'X-Webhook-Secret': 'wrong-secret' },
      method: 'POST',
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(401);
    expect(resend).not.toHaveBeenCalled();
  });

  it('forwards inbound raw messages and envelope headers to the backend', async () => {
    const backend = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', backend);
    const raw = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('raw email'));
        controller.close();
      },
    });
    const message = {
      from: 'alice@example.com',
      raw,
      to: 'agent@mail.taskmarket.example',
    } as ForwardableEmailMessage;

    await worker.email(message, env);

    expect(backend).toHaveBeenCalledWith(
      'https://api.taskmarket.example/email/inbound',
      expect.objectContaining({
        body: expect.any(ArrayBuffer),
        headers: expect.objectContaining({
          'X-Email-From': 'alice@example.com',
          'X-Email-To': 'agent@mail.taskmarket.example',
          'X-Webhook-Secret': env.EMAIL_WEBHOOK_SECRET,
        }),
        method: 'POST',
      })
    );
  });
});
