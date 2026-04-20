import { loadConfig } from './config.js';
import { createAppContainer, type Container } from './container.js';
import { createServer } from './server.js';
import { withRetry } from './shared/retry.js';
import { startSendConsumer } from './consumers/send-consumer.js';
import { Scheduler } from './workers/scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = createAppContainer(config);
  const logger = container.resolve('logger');

  logger.info({ port: config.base.port }, 'Starting m2r-email-api');

  await withRetry(
    () => container.resolve('scyllaClient').connect(),
    { maxAttempts: 10, delayMs: 3000 },
    logger,
  );
  logger.info('Connected to ScyllaDB');

  await withRetry(
    () => container.resolve('redisClient').connect(),
    { maxAttempts: 10, delayMs: 3000 },
    logger,
  );
  logger.info('Connected to Redis');

  await withRetry(
    () => container.resolve('amqpPublisher').connect(),
    { maxAttempts: 10, delayMs: 3000 },
    logger,
  );
  logger.info('Connected to RabbitMQ (publisher)');

  await withRetry(
    () => container.resolve('amqpConsumer').connect(),
    { maxAttempts: 10, delayMs: 3000 },
    logger,
  );
  logger.info('Connected to RabbitMQ (consumer)');

  await startSendConsumer(
    container.resolve('amqpConsumer'),
    container.resolve('dispatchService'),
    logger,
  );
  logger.info('Send consumer started');

  let scheduler: Scheduler | null = null;
  if (config.scheduler.enabled) {
    scheduler = new Scheduler(
      container.resolve('jobRepo'),
      container.resolve('dispatchService'),
      logger,
      {
        tickSeconds: config.scheduler.tickSeconds,
        batch: config.scheduler.batch,
      },
    );
    scheduler.start();
  }

  const app = await createServer(container);
  await app.listen({ host: '0.0.0.0', port: config.base.port });
  logger.info({ port: config.base.port }, 'email-api listening');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');
    try {
      if (scheduler) await scheduler.stop();
      await app.close();
      await shutdownContainer(container);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function shutdownContainer(container: Container): Promise<void> {
  const logger = container.resolve('logger');
  try {
    await container.resolve('amqpConsumer').close();
  } catch (err) {
    logger.warn({ err }, 'amqpConsumer close error');
  }
  try {
    await container.resolve('amqpPublisher').close();
  } catch (err) {
    logger.warn({ err }, 'amqpPublisher close error');
  }
  try {
    await container.resolve('redisClient').quit();
  } catch (err) {
    logger.warn({ err }, 'redis quit error');
  }
  try {
    await container.resolve('scyllaClient').shutdown();
  } catch (err) {
    logger.warn({ err }, 'scylla shutdown error');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
