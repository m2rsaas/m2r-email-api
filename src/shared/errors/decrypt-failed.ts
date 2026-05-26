import { BaseError } from './base-error.js';

export class DecryptFailedError extends BaseError {
  constructor(public readonly cause: string) {
    super(`Failed to decrypt integration config: ${cause}`, 'fatal');
  }
}
