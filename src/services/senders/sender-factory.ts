import type { IEmailSender } from './email-sender.js';

export class SenderFactory {
  private readonly registry = new Map<string, IEmailSender>();

  register(sender: IEmailSender): void {
    this.registry.set(sender.code.toUpperCase(), sender);
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
