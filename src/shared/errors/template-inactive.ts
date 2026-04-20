import { BaseError } from './base-error';

export class TemplateInactiveError extends BaseError {
  constructor(public readonly templateId: string, public readonly status: string) {
    super(`Template ${templateId} is not ACTIVE (status=${status})`, 'fatal');
  }
}
