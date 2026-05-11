import {
  asFunction,
  asValue,
  createContainer,
  InjectionMode,
  type AwilixContainer,
} from 'awilix';
import type { AppConfig } from './config.js';
import { createLogger, type Logger } from './lib/logger.js';
import { ScyllaClient } from './lib/scylla-client.js';
import { RedisClient } from './lib/redis-client.js';
import { AmqpPublisher } from './lib/amqp-publisher.js';
import { AmqpConsumer } from './lib/amqp-consumer.js';
import { compile } from './lib/handlebars-singleton.js';

import { EmailJobRepository } from './repositories/email-job-repository.js';
import { EmailJobLogRepository } from './repositories/email-job-log-repository.js';
import { SendTemplateRepository } from './repositories/send-template-repository.js';
import { IntegrationRepository } from './repositories/integration-repository.js';

import { TemplateRenderService } from './services/template-render-service.js';
import { TemplateResolverService } from './services/template-resolver-service.js';
import { IntegrationResolverService } from './services/integration-resolver-service.js';
import { RetryPolicy } from './services/retry-policy.js';
import { SenderFactory } from './services/senders/sender-factory.js';
import { NodemailerSender } from './services/senders/nodemailer-sender.js';
import { TwilioSendGridSender } from './services/senders/twilio-sendgrid-sender.js';
import { EmailDispatchService } from './services/email-dispatch-service.js';

/**
 * Mapa de dependencias registradas no container Awilix.
 *
 * Observacoes:
 *  - Repositorios recebem o `Client` do cassandra-driver (via
 *    `ScyllaClient#getRawClient()`) — padrao ja estabelecido nos repos da Fase 3.
 *  - `AmqpPublisher`/`AmqpConsumer` expoem API propria (`connect/publish/consume/close`);
 *    o `startSendConsumer` consome via `consumer.consume(handler)` e o handler
 *    retorna `{ ack, requeue? }`.
 *  - `ScyllaClient` expoe `.shutdown()`, `RedisClient` expoe `.quit()`.
 */
export interface ContainerCradle {
  config: AppConfig;
  logger: Logger;
  scyllaClient: ScyllaClient;
  redisClient: RedisClient;
  amqpPublisher: AmqpPublisher;
  amqpConsumer: AmqpConsumer;
  jobRepo: EmailJobRepository;
  logRepo: EmailJobLogRepository;
  templateRepo: SendTemplateRepository;
  integrationRepo: IntegrationRepository;
  renderService: TemplateRenderService;
  templateResolver: TemplateResolverService;
  integrationResolver: IntegrationResolverService;
  retryPolicy: RetryPolicy;
  senderFactory: SenderFactory;
  dispatchService: EmailDispatchService;
}

export type Container = AwilixContainer<ContainerCradle>;

export function createAppContainer(config: AppConfig): Container {
  const container: Container = createContainer<ContainerCradle>({
    injectionMode: InjectionMode.PROXY,
  });

  const logger = createLogger(config.base.serviceName, config.base.logLevel);

  container.register({
    config: asValue(config),
    logger: asValue(logger),

    scyllaClient: asFunction(
      ({ logger: log, config: cfg }: ContainerCradle) =>
        new ScyllaClient(
          {
            hosts: cfg.scylla.hosts,
            datacenter: cfg.scylla.datacenter,
            username: cfg.scylla.username,
            password: cfg.scylla.password,
          },
          log,
        ),
    ).singleton(),

    redisClient: asFunction(
      ({ logger: log, config: cfg }: ContainerCradle) =>
        new RedisClient(
          {
            host: cfg.redis.host,
            port: cfg.redis.port,
            password: cfg.redis.password,
            db: cfg.redis.db,
          },
          log,
        ),
    ).singleton(),

    amqpPublisher: asFunction(
      ({ logger: log, config: cfg }: ContainerCradle) =>
        new AmqpPublisher(cfg.amqp.url, log, cfg.amqp.exchange),
    ).singleton(),

    amqpConsumer: asFunction(
      ({ logger: log, config: cfg }: ContainerCradle) =>
        new AmqpConsumer(cfg.amqp.url, log, {
          exchange: cfg.amqp.exchange,
          queue: cfg.amqp.queue,
          bindings: cfg.amqp.bindings,
          dlx: cfg.amqp.dlxExchange,
          prefetch: cfg.amqp.prefetch,
        }),
    ).singleton(),

    jobRepo: asFunction(
      ({ scyllaClient }: ContainerCradle) =>
        new EmailJobRepository(scyllaClient.getRawClient()),
    ).singleton(),

    logRepo: asFunction(
      ({ scyllaClient }: ContainerCradle) =>
        new EmailJobLogRepository(scyllaClient.getRawClient()),
    ).singleton(),

    templateRepo: asFunction(
      ({ scyllaClient }: ContainerCradle) =>
        new SendTemplateRepository(scyllaClient.getRawClient()),
    ).singleton(),

    integrationRepo: asFunction(
      ({ scyllaClient }: ContainerCradle) =>
        new IntegrationRepository(scyllaClient.getRawClient()),
    ).singleton(),

    renderService: asFunction(() => new TemplateRenderService({ compile })).singleton(),

    templateResolver: asFunction(
      ({ logger: log, config: cfg }: ContainerCradle) =>
        new TemplateResolverService({
          gpmBackendUrl: cfg.gpmBackend.url,
          internalApiKey: cfg.gpmBackend.apiKey,
          logger: log,
        }),
    ).singleton(),

    retryPolicy: asFunction(() => new RetryPolicy()).singleton(),

    integrationResolver: asFunction(
      ({ integrationRepo, redisClient, logger: log, config: cfg }: ContainerCradle) =>
        new IntegrationResolverService(
          integrationRepo,
          redisClient,
          log,
          cfg.crypto.integrationCacheTtlSeconds,
        ),
    ).singleton(),

    senderFactory: asFunction(() => {
      const f = new SenderFactory();
      // Senders canonicos
      f.register(new NodemailerSender()); // code: SMTP_GENERIC
      f.register(new TwilioSendGridSender()); // code: SENDGRID
      // Aliases SMTP — todos compartilham o mesmo protocolo (NodemailerSender),
      // diferenciando apenas pelas credenciais armazenadas em `config` da
      // integracao. Mantem alinhamento com o catalogo do painel GPM.
      f.registerAlias('GENERIC', 'SMTP_GENERIC');
      f.registerAlias('GMAIL', 'SMTP_GENERIC');
      f.registerAlias('HOSTINGER', 'SMTP_GENERIC');
      f.registerAlias('HOSTGATOR', 'SMTP_GENERIC');
      // Alias SendGrid — frontend grava como TWILIO.
      f.registerAlias('TWILIO', 'SENDGRID');
      return f;
    }).singleton(),

    dispatchService: asFunction(
      ({
        jobRepo,
        logRepo,
        templateRepo,
        integrationResolver,
        renderService,
        templateResolver,
        senderFactory,
        retryPolicy,
        amqpPublisher,
        logger: log,
        config: cfg,
      }: ContainerCradle) =>
        new EmailDispatchService({
          jobRepo,
          logRepo,
          templateRepo,
          integrationResolver,
          renderService,
          templateResolver,
          senderFactory,
          retryPolicy,
          publisher: amqpPublisher,
          logger: log,
          defaultTimeoutMs: cfg.sender.defaultTimeoutMs,
        }),
    ).singleton(),
  });

  return container;
}
