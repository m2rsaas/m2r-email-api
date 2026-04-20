export interface SendParams {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  timeoutMs: number;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  responseCode?: string | number;
  error?: string;
  classification?: 'hard' | 'soft';
}

export interface IEmailSender {
  readonly code: string;
  send(params: SendParams, config: unknown): Promise<SendResult>;
}
