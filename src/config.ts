import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'qa', 'production']).default('development'),
  SERVICE_NAME: z.string().default('m2r-email-api'),
  LOG_LEVEL: z.string().default('info'),
  PORT: z.coerce.number().int().positive().default(3009),
  URL_PREFIX: z.string().default('/api/v1'),
  URL_INTERNAL: z.string().default('http://localhost:3009'),
  URL_EXTERNAL: z.string().default('http://localhost:3009'),

  SCYLLA_HOSTS: z.string(),
  SCYLLA_DATACENTER: z.string().default('datacenter1'),
  SCYLLA_USERNAME: z.string().optional(),
  SCYLLA_PASSWORD: z.string().optional(),

  REDIS_HOSTS: z.string(),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),

  AMQP_URL: z.string(),
  AMQP_EXCHANGE: z.string().default('m2ria.email'),
  AMQP_DLX_EXCHANGE: z.string().default('m2ria.dlx'),
  AMQP_QUEUE: z.string().default('m2r-email-api.send'),
  AMQP_BINDINGS: z.string().default('email.send.#'),
  AMQP_PREFETCH: z.coerce.number().int().positive().default(10),

  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().positive().default(30),
  SCHEDULER_BATCH: z.coerce.number().int().positive().default(100),

  M2R_CRYPTO_KEY: z.string().min(10),
  INTEGRATION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  JWT_SECRET: z.string(),

  SWAGGER_AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SWAGGER_USERNAME: z.string().default('m2radmin'),
  SWAGGER_PASSWORD: z.string().default('change-me'),

  SENDER_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  GPM_BACKEND_URL: z.string().default('http://gpm-backend:3008'),
  INTERNAL_API_KEY: z.string().default(''),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const e = parsed.data;

  return {
    base: {
      env: e.NODE_ENV,
      serviceName: e.SERVICE_NAME,
      logLevel: e.LOG_LEVEL,
      port: e.PORT,
      urlPrefix: e.URL_PREFIX,
      urlInternal: e.URL_INTERNAL,
      urlExternal: e.URL_EXTERNAL,
    },
    scylla: {
      hosts: e.SCYLLA_HOSTS.split(',').map((h) => h.trim()).filter(Boolean),
      datacenter: e.SCYLLA_DATACENTER,
      username: e.SCYLLA_USERNAME,
      password: e.SCYLLA_PASSWORD,
    },
    redis: {
      host: e.REDIS_HOSTS.split(',')[0]?.trim() ?? 'localhost',
      port: e.REDIS_PORT,
      password: e.REDIS_PASSWORD,
      db: e.REDIS_DB,
    },
    amqp: {
      url: e.AMQP_URL,
      exchange: e.AMQP_EXCHANGE,
      dlxExchange: e.AMQP_DLX_EXCHANGE,
      queue: e.AMQP_QUEUE,
      bindings: e.AMQP_BINDINGS.split(',').map((b) => b.trim()).filter(Boolean),
      prefetch: e.AMQP_PREFETCH,
    },
    scheduler: {
      enabled: e.SCHEDULER_ENABLED,
      tickSeconds: e.SCHEDULER_TICK_SECONDS,
      batch: e.SCHEDULER_BATCH,
    },
    crypto: {
      key: e.M2R_CRYPTO_KEY,
      integrationCacheTtlSeconds: e.INTEGRATION_CACHE_TTL_SECONDS,
    },
    jwt: {
      secret: e.JWT_SECRET,
    },
    swagger: {
      enabled: e.SWAGGER_AUTH_ENABLED,
      username: e.SWAGGER_USERNAME,
      password: e.SWAGGER_PASSWORD,
    },
    sender: {
      defaultTimeoutMs: e.SENDER_DEFAULT_TIMEOUT_MS,
    },
    gpmBackend: {
      url: e.GPM_BACKEND_URL,
    },
    internalAuth: {
      apiKey: e.INTERNAL_API_KEY,
    },
  };
}
