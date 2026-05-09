import { describe, expect, it, vi } from 'vitest';
import { NodemailerSender, htmlToPlainText } from './nodemailer-sender.js';

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

  // Regressao: o GPM grava a senha SMTP no `int_integrations.config` sob a
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

  // Regressao SpamAssassin (MIME_HTML_ONLY +0.1): todo envio precisa ser
  // multipart/alternative. Se o caller passou apenas `body` (HTML), o sender
  // deve derivar `text` automaticamente.
  it('derives text/plain from html body when caller did not provide text', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<x>', response: '250 OK' });
    const factory = vi.fn().mockReturnValue({ sendMail });
    const sender = new NodemailerSender(factory as any);
    const html =
      '<!DOCTYPE html><html><head><title>Hi</title></head><body><p>Ola, <b>mundo</b>!</p></body></html>';
    await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: html, timeoutMs: 5000 },
      config,
    );
    const args = sendMail.mock.calls[0][0];
    expect(args.html).toBe(html);
    expect(typeof args.text).toBe('string');
    expect(args.text).toContain('Ola,');
    expect(args.text).toContain('mundo');
    // E nao deve sobrar tag HTML
    expect(args.text).not.toMatch(/<[^>]+>/);
  });

  it('respects caller-provided text and does not override it', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<x>', response: '250 OK' });
    const factory = vi.fn().mockReturnValue({ sendMail });
    const sender = new NodemailerSender(factory as any);
    await sender.send(
      {
        to: ['x@y'],
        cc: [],
        bcc: [],
        subject: 's',
        body: '<p>HTML</p>',
        text: 'Versao plain explicita',
        timeoutMs: 5000,
      },
      config,
    );
    const args = sendMail.mock.calls[0][0];
    expect(args.text).toBe('Versao plain explicita');
  });
});

describe('htmlToPlainText', () => {
  it('strips tags and decodes common entities', () => {
    const out = htmlToPlainText(
      '<p>Hello&nbsp;<b>world</b> &amp; friends &lt;3 &quot;test&quot; &#39;ok&#39;</p>',
    );
    expect(out).toContain('Hello');
    expect(out).toContain('world');
    expect(out).toContain('& friends');
    expect(out).toContain('<3');
    expect(out).toContain('"test"');
    expect(out).toContain("'ok'");
    expect(out).not.toMatch(/<[^>]+>/);
  });

  it('removes script and style blocks entirely (including content)', () => {
    const out = htmlToPlainText(
      '<style>body{color:red}</style><script>alert(1)</script><p>safe</p>',
    );
    expect(out).toContain('safe');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('color:red');
  });

  it('converts <br> and </p> into line breaks', () => {
    const out = htmlToPlainText('<p>linha1</p><p>linha2</p>linha3<br/>linha4');
    expect(out.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('linha1');
    expect(out).toContain('linha4');
  });

  it('handles empty input safely', () => {
    expect(htmlToPlainText('')).toBe('');
  });

  it('decodes numeric entities', () => {
    const out = htmlToPlainText('<p>caf&#233; &#x00E9;</p>');
    expect(out).toContain('café');
  });

  it('collapses excessive whitespace and blank lines', () => {
    const out = htmlToPlainText('<p>a</p>\n\n\n\n<p>b</p>');
    // No maximo 2 quebras consecutivas
    expect(out).not.toMatch(/\n{3,}/);
  });
});
