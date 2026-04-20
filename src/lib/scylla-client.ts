import {
  Client,
  auth,
  policies,
  QueryOptions as DriverQueryOptions,
  types,
} from 'cassandra-driver';
import type { IScyllaClient } from '../shared/interfaces/scylla-client.js';
import type { Logger } from './logger.js';

export interface ScyllaClientConfig {
  hosts: string[];
  datacenter: string;
  username?: string;
  password?: string;
}

export interface QueryOptions {
  prepare?: boolean;
  consistency?: number;
}

export class ScyllaClient implements IScyllaClient {
  private client: Client;

  constructor(config: ScyllaClientConfig, private logger?: Logger) {
    const authProvider = config.username && config.password
      ? new auth.PlainTextAuthProvider(config.username, config.password)
      : undefined;

    this.client = new Client({
      contactPoints: config.hosts,
      localDataCenter: config.datacenter,
      authProvider,
      policies: {
        retry: new policies.retry.RetryPolicy(),
      },
      queryOptions: {
        prepare: true,
        consistency: types.consistencies.localQuorum,
      },
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  getRawClient(): Client {
    return this.client;
  }

  async execute(
    query: string,
    params?: unknown[],
    options?: QueryOptions,
  ): Promise<types.ResultSet> {
    const opts: DriverQueryOptions = {};
    if (options?.prepare !== undefined) {
      opts.prepare = options.prepare;
    }
    if (options?.consistency !== undefined) {
      opts.consistency = options.consistency;
    }
    return this.client.execute(query, params as [], opts);
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.execute('SELECT now() FROM system.local');
      return true;
    } catch (error) {
      this.logger?.warn({ error }, 'ScyllaDB health check failed');
      return false;
    }
  }
}
