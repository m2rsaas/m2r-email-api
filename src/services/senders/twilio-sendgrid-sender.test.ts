import { describe, expect, it, vi } from 'vitest';
import { TwilioSendGridSender } from './twilio-sendgrid-sender.js';

describe('TwilioSendGridSender', () => {
  const config = { apiKey: 'SG.test', fromEmail: 'no@rep.com', fromName: 'X' };

  const makeSender = (resolveValue?: unknown, rejectValue?: unknown) => {
    const send = vi.fn();
    if (rejectValue) send.mockRejectedValue(rejectValue);
    else send.mockResolvedValue(resolveValue);
    const setApiKey = vi.fn();
    return new TwilioSendGridSender({ send, setApiKey } as any);
  };

  it('sends successfully', async () => {
    const sender = makeSender([{ statusCode: 202, headers: { 'x-message-id': 'mid-1' } }]);
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.success).toBe(true);
    expect(res.messageId).toBe('mid-1');
  });

  it('classifies 401 as hard', async () => {
    const sender = makeSender(undefined, { code: 401, message: 'unauthorized' });
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.success).toBe(false);
    expect(res.classification).toBe('hard');
  });

  it('classifies 429 as soft', async () => {
    const sender = makeSender(undefined, { code: 429, message: 'rate limit' });
    const res = await sender.send(
      { to: ['x@y'], cc: [], bcc: [], subject: 's', body: 'b', timeoutMs: 5000 },
      config,
    );
    expect(res.classification).toBe('soft');
  });
});
