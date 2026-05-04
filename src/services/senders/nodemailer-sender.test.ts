import { describe, expect, it, vi } from 'vitest';
import { NodemailerSender } from './nodemailer-sender.js';

describe('NodemailerSender', () => {
  const config = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'u',
    pass: 'p',
    fromEmail: 'no-reply@example.com',
    fromName: 'Test',
  };

  const makeSender = (sendResult: unknown, shouldThrow?: Error) => {
    const sendMail = vi.fn();
    if (shouldThrow) sendMail.mockRejectedValue(shouldThrow);
    else sendMail.mockResolvedValue(sendResult);
    const factory = vi.fn().mockReturnValue({ sendMail });
    return new NodemailerSender(factory as any);
  };

  it('returns success on accepted send', async () => {
    const sender = makeSender({ messageId: '<abc>', accepted: ['x@y'], rejected: [], response: '250 OK' });
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.success).toBe(true);
    expect(res.messageId).toBe('<abc>');
  });

  it('classifies timeout as soft', async () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const sender = makeSender(null, err);
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.success).toBe(false);
    expect(res.classification).toBe('soft');
  });

  it('classifies auth failure as hard', async () => {
    const err = Object.assign(new Error('invalid login'), { responseCode: 535, code: 'EAUTH' });
    const sender = makeSender(null, err);
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.success).toBe(false);
    expect(res.classification).toBe('hard');
  });

  it('classifies 5xx as soft', async () => {
    const err = Object.assign(new Error('tempfail'), { responseCode: 550 });
    const sender = makeSender(null, err);
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.classification).toBe('soft');
  });

  // Regressao: o GPM grava a senha SMTP no `gpm_integrations.config` sob a
  // chave `password` (e nao `pass`). Antes do fix, o transporter subia sem
  // `auth` quando recebia o config decifrado, causando `554 Access denied`
  // no relay (visto em QA contra Hostinger).
  it('passes auth when config uses canonical `password` field', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<x>', response: '250 OK' });
    const factory = vi.fn().mockReturnValue({ sendMail });
    const sender = new NodemailerSender(factory as any);
    const cfgCanonical = {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'u',
      password: 'p', // <- canonico, gravado pelo GPM
      fromEmail: 'no-reply@example.com',
    };
    await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      cfgCanonical,
    );
    const opts = factory.mock.calls[0][0];
    expect(opts.auth).toEqual({ user: 'u', pass: 'p' });
  });

  it('omits auth when neither password nor pass is provided', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<x>', response: '250 OK' });
    const factory = vi.fn().mockReturnValue({ sendMail });
    const sender = new NodemailerSender(factory as any);
    const cfgNoAuth = {
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      user: '',
      fromEmail: 'no-reply@example.com',
    };
    await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      cfgNoAuth,
    );
    const opts = factory.mock.calls[0][0];
    expect(opts.auth).toBeUndefined();
  });
});
