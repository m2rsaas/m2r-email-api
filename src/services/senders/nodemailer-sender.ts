import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { IEmailSender, SendParams, SendResult } from './email-sender.js';

export interface NodemailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName?: string;
}

type TransportFactory = (options: SMTPTransport.Options) => Transporter;

export class NodemailerSender implements IEmailSender {
  readonly code = 'SMTP_GENERIC';
  constructor(private readonly factory: TransportFactory = nodemailer.createTransport) {}

  async send(params: SendParams, cfg: unknown): Promise<SendResult> {
    const config = cfg as NodemailerConfig;
    const transporter = this.factory({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: params.timeoutMs,
      greetingTimeout: params.timeoutMs,
      socketTimeout: params.timeoutMs,
    });

    try {
      const info = await transporter.sendMail({
        from: config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
        html: params.body,
      });
      return {
        success: true,
        messageId: info.messageId,
        responseCode: (info as unknown as { response?: string | number }).response ?? '250',
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { responseCode?: number };
      return {
        success: false,
        responseCode: e.responseCode,
        error: e.message,
        classification: this.classify(e),
      };
    }
  }

  private classify(err: NodeJS.ErrnoException & { responseCode?: number; code?: string }): 'hard' | 'soft' {
    if (err.code === 'EAUTH') return 'hard';
    if (err.code === 'ENOTFOUND') return 'hard';
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return 'soft';
    const rc = err.responseCode;
    if (!rc) return 'soft';
    if (rc === 421 || rc === 450 || rc === 451 || rc === 452) return 'soft';
    if (rc >= 500 && rc < 600) return 'soft';
    if (rc >= 400 && rc < 500) return 'hard';
    return 'soft';
  }
}
