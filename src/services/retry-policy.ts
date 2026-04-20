/**
 * Politica de retry para jobs de email.
 *
 * Classificacao de falha:
 *  - `fatal`: nunca retry (ex: template nao encontrado, config invalida)
 *  - `hard`: nunca retry (ex: remetente bloqueado, destinatario invalido permanente)
 *  - `soft`: retry com backoff exponencial ate `maxAttempts`
 *
 * Backoff (em segundos): 30, 120, 600, 3600, 21600 (30s, 2min, 10min, 1h, 6h).
 * Attempt `n` usa o n-esimo elemento do array (1-indexed).
 */
export class RetryPolicy {
  readonly maxAttempts = 5;
  private readonly backoffSeconds = [30, 120, 600, 3600, 21600];

  backoffMs(attempt: number): number {
    const idx = Math.max(1, Math.min(attempt, this.backoffSeconds.length)) - 1;
    return this.backoffSeconds[idx] * 1000;
  }

  shouldRetry(classification: 'fatal' | 'hard' | 'soft', attempt: number): boolean {
    if (classification !== 'soft') return false;
    return attempt < this.maxAttempts;
  }

  nextFireAt(attempt: number, now: Date = new Date()): Date {
    return new Date(now.getTime() + this.backoffMs(attempt));
  }
}
