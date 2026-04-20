export abstract class BaseError extends Error {
  public readonly classification: 'fatal' | 'hard' | 'soft';

  constructor(message: string, classification: 'fatal' | 'hard' | 'soft') {
    super(message);
    this.name = this.constructor.name;
    this.classification = classification;
  }
}
