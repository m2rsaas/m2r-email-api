import type { ConsumeMessage } from 'amqplib';

export interface ConsumerOptions {
  exchange: string;
  queue: string;
  bindings: string[];
  dlx?: string;
  prefetch?: number;
}

export interface ConsumeResult {
  ack: boolean;
  requeue?: boolean;
}

export type ConsumeHandler = (
  envelope: unknown,
  raw: ConsumeMessage,
) => Promise<ConsumeResult>;

export interface IAmqpConsumer {
  connect(): Promise<void>;
  consume(handler: ConsumeHandler): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}
