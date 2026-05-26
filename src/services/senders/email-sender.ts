export interface SendParams {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Corpo HTML (renderizado via Handlebars). */
  body: string;
  /**
   * Versao `text/plain` opcional. Quando ausente, o sender (SMTP) deve
   * derivar automaticamente a partir de `body` para garantir o envio em
   * `multipart/alternative` e nao ser penalizado pelo SpamAssassin.
   */
  text?: string;
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
