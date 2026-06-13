import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { IEmailSender, SendParams, SendResult } from './email-sender.js';

/**
 * Deriva uma versao `text/plain` minimamente legivel a partir de um HTML.
 *
 * Por que existe: SpamAssassin penaliza emails enviados como `text/html`
 * puro (regra MIME_HTML_ONLY, +0.1) e tambem mensagens HTML sem o envelope
 * `<html>...</html>` (HTML_MIME_NO_HTML_TAG, +0.635). Resolver o segundo
 * passa por usar templates com documento HTML completo. Resolver o primeiro
 * passa por enviar `multipart/alternative`, ou seja, tambem uma versao
 * `text/plain` ao lado do HTML.
 *
 * Implementacao deliberadamente minimalista (sem nova dependencia):
 *   1. Remove blocos `<script>` / `<style>` (incluindo conteudo).
 *   2. Converte `<br>` e `</p>` em quebras de linha (preserva paragrafacao).
 *   3. Remove qualquer outra tag.
 *   4. Decodifica as entidades HTML mais comuns.
 *   5. Colapsa espacos em branco / linhas vazias excessivas.
 *
 * Nao tenta lidar com tabelas/listas/links sofisticados — para emails
 * transacionais simples (boas-vindas, recuperacao de senha, sandbox SMTP)
 * a saida e suficiente para o filtro anti-spam reconhecer a parte texto.
 * Se o template ficar realmente complexo, o caller pode passar `text`
 * explicitamente (campo opcional em `SendParams`) que sera respeitado.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutScripts
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<\s*\/\s*div\s*>/gi, '\n')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n\n');
  const withoutTags = withBreaks.replace(/<[^>]+>/g, '');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Decode entidades numericas (&#123; e &#x7B;) — conservador, ignora invalido.
    .replace(/&#(\d+);/g, (_m, n: string) => {
      const code = Number.parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => {
      const code = Number.parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
  // Normaliza espacos: tabs/CR -> espaco simples; colapsa runs de espaco;
  // reduz 3+ quebras consecutivas a 2; trim global.
  return decoded
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Configuracao canonica do sender SMTP.
 *
 * IMPORTANTE: o campo da senha aceita dois nomes para evitar mismatch entre
 * quem cifra (GPM grava `password` em `int_integrations.config`) e quem
 * decifra/consome aqui. `password` e o nome canonico usado em todo o
 * ecossistema (GPM frontend/backend, painel de Integracoes, validacao,
 * `encrypted_fields`); `pass` permanece aceito como alias retroativo para
 * nao quebrar testes/integracoes legadas.
 *
 * Sem essa tolerancia, o transporter sobe SEM `auth`, o relay rejeita o IP
 * de origem e o servidor SMTP responde `554 5.7.1 ... Access denied` (ja
 * observado em QA contra Hostinger).
 */
export interface NodemailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Nome canonico (gravado pelo GPM em `int_integrations.config`). */
  password?: string;
  /** Alias retroativo (testes legados / configs antigas). */
  pass?: string;
  /** Remetente — nome canonico usado pelas integracoes GPM. */
  fromEmail?: string;
  /**
   * Alias do remetente usado pelas integracoes de TENANT: o contrato SMTP
   * grava o "from" na chave `from` (ver contracts INTEGRATION_SAFE_FIELDS.SMTP),
   * enquanto o GPM grava `fromEmail`. Sem aceitar os dois, o `from` fica vazio
   * e o MTA envia como `MAILER-DAEMON@MISSING_DOMAIN` -> o Gmail descarta
   * silenciosamente. Mesma estrategia do alias `password ?? pass` acima.
   */
  from?: string;
  fromName?: string;
}

type TransportFactory = (options: SMTPTransport.Options) => Transporter;

export class NodemailerSender implements IEmailSender {
  readonly code = 'SMTP_GENERIC';
  constructor(private readonly factory: TransportFactory = nodemailer.createTransport) {}

  async send(params: SendParams, cfg: unknown): Promise<SendResult> {
    const config = cfg as NodemailerConfig;
    // Aceita `password` (canonico) e `pass` (alias). Ver doc da interface.
    const pass = config.password ?? config.pass;
    const hasAuth = Boolean(config.user && pass);
    const transporter = this.factory({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(hasAuth ? { auth: { user: config.user, pass: pass! } } : {}),
      connectionTimeout: params.timeoutMs,
      greetingTimeout: params.timeoutMs,
      socketTimeout: params.timeoutMs,
    });

    // Garante envio em multipart/alternative: se o caller nao passou `text`,
    // derivamos uma versao plain a partir do HTML. Reduz penalidade do
    // SpamAssassin (regra MIME_HTML_ONLY) e melhora compatibilidade com
    // clientes de email que preferem texto puro.
    const plainText =
      params.text && params.text.trim() ? params.text : htmlToPlainText(params.body);

    // Remetente: aceita `fromEmail` (GPM) e `from` (tenant). Ver doc da interface.
    // Sem isso o From vai vazio -> MAILER-DAEMON@MISSING_DOMAIN -> Gmail dropa.
    const fromEmail = config.fromEmail ?? config.from;
    if (!fromEmail) {
      return {
        success: false,
        error: 'Integracao SMTP sem remetente (fromEmail/from). Configure o "From" na integracao.',
        classification: 'hard',
      };
    }

    try {
      const info = await transporter.sendMail({
        from: config.fromName ? `${config.fromName} <${fromEmail}>` : fromEmail,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
        html: params.body,
        text: plainText,
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
