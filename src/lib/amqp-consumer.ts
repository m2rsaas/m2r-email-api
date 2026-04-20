import amqp, { type ChannelModel, type Channel, type ConsumeMessage } from 'amqplib';
import type {
  ConsumeHandler,
  ConsumerOptions,
  IAmqpConsumer,
} from '../shared/interfaces/amqp-consumer.js';
import type { Logger } from './logger.js';

export class AmqpConsumer implements IAmqpConsumer {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private consumerTag: string | null = null;

  constructor(
    private readonly url: string,
    private readonly logger: Logger,
    private readonly opts: ConsumerOptions,
  ) {}

  async connect(): Promise<void> {
    if (this.channel) return;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.opts.exchange, 'topic', { durable: true });

    if (this.opts.dlx) {
      await this.channel.assertExchange(this.opts.dlx, 'topic', { durable: true });
    }

    const queueArgs: Record<string, unknown> = {};
    if (this.opts.dlx) {
      queueArgs['x-dead-letter-exchange'] = this.opts.dlx;
    }
    await this.channel.assertQueue(this.opts.queue, {
      durable: true,
      arguments: queueArgs,
    });

    for (const pattern of this.opts.bindings) {
      await this.channel.bindQueue(this.opts.queue, this.opts.exchange, pattern);
    }

    if (typeof this.opts.prefetch === 'number' && this.opts.prefetch > 0) {
      await this.channel.prefetch(this.opts.prefetch);
    }

    this.connection.on('close', () => {
      this.logger.warn({ queue: this.opts.queue }, 'AMQP consumer connection closed');
      this.channel = null;
      this.connection = null;
      this.consumerTag = null;
    });
    this.connection.on('error', (err) => {
      this.logger.error({ err: err.message }, 'AMQP consumer connection error');
    });

    this.logger.info(
      {
        exchange: this.opts.exchange,
        queue: this.opts.queue,
        bindings: this.opts.bindings,
        dlx: this.opts.dlx,
        prefetch: this.opts.prefetch,
      },
      'AMQP consumer connected',
    );
  }

  async consume(handler: ConsumeHandler): Promise<void> {
    if (!this.channel) {
      throw new Error('AMQP consumer not connected');
    }
    const channel = this.channel;
    const { consumerTag } = await channel.consume(
      this.opts.queue,
      async (raw: ConsumeMessage | null) => {
        if (!raw) return;
        let envelope: unknown;
        try {
          envelope = JSON.parse(raw.content.toString('utf8'));
        } catch (err) {
          this.logger.warn({ err }, 'Invalid JSON in message, sending to DLX');
          channel.nack(raw, false, false);
          return;
        }
        try {
          const result = await handler(envelope, raw);
          if (result.ack) {
            channel.ack(raw);
          } else {
            channel.nack(raw, false, result.requeue ?? false);
          }
        } catch (err) {
          this.logger.error({ err }, 'Handler threw; nacking without requeue');
          channel.nack(raw, false, false);
        }
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
    this.logger.info({ consumerTag, queue: this.opts.queue }, 'AMQP consumer started');
  }

  isConnected(): boolean {
    return this.channel !== null && this.connection !== null;
  }

  async close(): Promise<void> {
    try {
      if (this.channel && this.consumerTag) {
        await this.channel.cancel(this.consumerTag);
      }
    } catch {
      // ignore
    }
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
    this.consumerTag = null;
  }
}
