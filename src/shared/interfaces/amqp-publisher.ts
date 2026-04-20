export interface PublishOptions {
  persistent?: boolean;
  messageId?: string;
  correlationId?: string;
  headers?: Record<string, unknown>;
}

export interface IAmqpPublisher {
  connect(): Promise<void>;
  publish(routingKey: string, payload: unknown, opts?: PublishOptions): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
}
