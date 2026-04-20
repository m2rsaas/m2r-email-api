import Redis, { type RedisOptions } from 'ioredis';
import type { IRedisClient } from '../shared/interfaces/redis-client.js';
import type { Logger } from './logger.js';

export interface RedisClientConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export class RedisClient implements IRedisClient {
  private readonly client: Redis;
  private ready = false;

  constructor(config: RedisClientConfig, private readonly logger: Logger) {
    const options: RedisOptions = {
      host: config.host,
      port: config.port,
      db: config.db,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
    if (config.password) {
      options.password = config.password;
    }
    this.client = new Redis(options);
    this.client.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Redis error');
    });
    this.client.on('end', () => {
      this.ready = false;
      this.logger.warn('Redis connection ended');
    });
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    // Em caso de retry apos falha (ex.: WRONGPASS), ioredis pode ter deixado
    // o cliente em estado 'connecting' / 'reconnecting'. Chamar connect()
    // novamente nesse estado lanca 'Redis is already connecting/connected'.
    // Forcamos disconnect() sincrono para voltar ao estado 'end' antes de reabrir.
    const status = this.client.status;
    if (status !== 'wait' && status !== 'end') {
      this.logger.warn({ status }, 'Redis client in unexpected state, resetting before reconnect');
      this.client.disconnect();
    }
    await this.client.connect();
    await new Promise<void>((resolve, reject) => {
      if (this.client.status === 'ready') {
        resolve();
        return;
      }
      const onReady = (): void => {
        this.client.off('error', onError);
        resolve();
      };
      const onError = (err: Error): void => {
        this.client.off('ready', onReady);
        reject(err);
      };
      this.client.once('ready', onReady);
      this.client.once('error', onError);
    });
    this.ready = true;
    this.logger.info('Redis connected');
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (typeof ttlSeconds === 'number') {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async quit(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
    this.ready = false;
  }
}
