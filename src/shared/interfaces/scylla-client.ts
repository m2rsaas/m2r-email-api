import type { types, Client } from 'cassandra-driver';

export interface QueryOptions {
  prepare?: boolean;
  consistency?: number;
}

export interface IScyllaClient {
  connect(): Promise<void>;
  execute(query: string, params?: unknown[], options?: QueryOptions): Promise<types.ResultSet>;
  shutdown(): Promise<void>;
  isHealthy(): Promise<boolean>;
  getRawClient(): Client;
}
