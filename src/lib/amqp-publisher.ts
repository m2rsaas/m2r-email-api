import amqp, { type ChannelModel, type Channel } from 'amqplib';
import type { IAmqpPublisher, PublishOptions } from '../shared/interfaces/amqp-publisher.js';
import type { Logger } from './logger.js';

export class AmqpPublisher implements IAmqpPublisher {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
    private readonly exchange: string,
  ) {}

  async connect(): Promise<void> {
    if (this.channel) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    this.connection.on('close', () => {
      this.logger.warn({ exchange: this.exchange }, 'AMQP publisher connection closed');
      this.channel = null;
      this.connection = null;
    });
    this.connection.on('error', (err) => {
      this.logger.error({ err: err.message }, 'AMQP publisher connection error');
    });
    this.logger.info({ exchange: this.exchange }, 'AMQP publisher connected');
  }

  async publish(routingKey: string, payload: unknown, opts?: PublishOptions): Promise<void> {
    if (!this.channel) {
      this.logger.warn({ routingKey }, 'AMQP publisher not connected, dropping publish');
      return;
    }
    const body = Buffer.from(JSON.stringify(payload ?? {}));
    this.channel.publish(this.exchange, routingKey, body, {
      contentType: 'application/json',
      persistent: opts?.persistent ?? true,
      messageId: opts?.messageId,
      correlationId: opts?.correlationId,
      headers: opts?.headers,
    });
  }

  isConnected(): boolean {
    return this.channel !== null && this.connection !== null;
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
    } catch {
      // ignore
    }
    try {
      await this.connection?.close();
    } catch {
      // ignore
    }
    this.channel = null;
    this.connection = null;
  }
}
