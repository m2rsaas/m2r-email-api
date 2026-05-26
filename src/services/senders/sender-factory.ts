import type { IEmailSender } from './email-sender.js';

export class SenderFactory {
  private readonly registry = new Map<string, IEmailSender>();

  register(sender: IEmailSender): void {
    this.registry.set(sender.code.toUpperCase(), sender);
  }

  /**
   * Registra um alias adicional para um sender ja registrado.
   *
   * Util quando o catalogo de providers exposto ao painel/integracoes
   * usa codigos diferentes do `code` canonico do sender (ex.: GENERIC,
   * GMAIL, HOSTINGER, HOSTGATOR -> SMTP_GENERIC; TWILIO -> SENDGRID).
   */
  registerAlias(alias: string, existingCode: string): void {
    const sender = this.registry.get(existingCode.toUpperCase());
    if (!sender) {
      throw new Error(
        `Cannot register alias "${alias}" — sender "${existingCode}" not registered`,
      );
    }
    this.registry.set(alias.toUpperCase(), sender);
  }

  pick(providerCode: string): IEmailSender {
    const normalized = providerCode.toUpperCase();
    const found = this.registry.get(normalized);
    if (!found) {
      throw new Error(`No sender registered for provider "${providerCode}"`);
    }
    return found;
  }
}
