import sendGridDefault from '@sendgrid/mail';
import type { IEmailSender, SendParams, SendResult } from './email-sender.js';

export interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

type SendGridClient = typeof sendGridDefault;

export class TwilioSendGridSender implements IEmailSender {
  readonly code = 'SENDGRID';

  constructor(private readonly client: SendGridClient = sendGridDefault) {}

  async send(params: SendParams, cfg: unknown): Promise<SendResult> {
    const config = cfg as SendGridConfig;
    this.client.setApiKey(config.apiKey);
    try {
      const [res] = await this.client.send({
        to: params.to,
        cc: params.cc.length ? params.cc : undefined,
        bcc: params.bcc.length ? params.bcc : undefined,
        from: { email: config.fromEmail, name: config.fromName ?? '' },
        subject: params.subject,
        html: params.body,
      });
      return {
        success: true,
        messageId: (res?.headers as Record<string, string> | undefined)?.['x-message-id'] ?? undefined,
        responseCode: res?.statusCode,
      };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      return {
        success: false,
        responseCode: e.code,
        error: e.message ?? 'unknown',
        classification: this.classify(e.code ?? 0),
      };
    }
  }

  private classify(code: number): 'hard' | 'soft' {
    if (code === 429) return 'soft';
    if (code >= 500 && code < 600) return 'soft';
    if (code >= 400 && code < 500) return 'hard';
    if (code === 0) return 'soft';
    return 'soft';
  }
}
