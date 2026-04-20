import { BaseError } from './base-error.js';

export class TemplateNotFoundError extends BaseError {
  constructor(public readonly templateId: string, public readonly scope: string) {
    super(`Template ${templateId} not found in scope ${scope}`, 'fatal');
  }
}
