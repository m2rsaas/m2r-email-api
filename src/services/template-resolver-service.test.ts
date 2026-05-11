import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateResolverService } from './template-resolver-service.js';
import { NoDefaultTemplateError } from '../shared/errors/index.js';
import type { Logger } from '../lib/logger.js';

describe('TemplateResolverService', () => {
  let logger: Logger;
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: TemplateResolverService;

  beforeEach(() => {
    logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    fetchMock = vi.fn();
    service = new TemplateResolverService({
      gpmBackendUrl: 'http://gpm-backend:3008',
      internalApiKey: 'secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger,
    });
  });

  it('retorna o templateId direto quando informado', async () => {
    const result = await service.resolve({
      scope: 'GPM',
      templateId: '11111111-1111-4111-8111-111111111111',
      channelType: 'EMAIL',
    });
    expect(result).toEqual({ templateId: '11111111-1111-4111-8111-111111111111' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolve via gpm-backend quando vem type+channel', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { id: '22222222-2222-4222-8222-222222222222', isDefault: true },
      }),
    });
    const result = await service.resolve({
      scope: 'GPM',
      type: 'PASSWORD_RECOVERY',
      channelType: 'EMAIL',
    });
    expect(result).toEqual({ templateId: '22222222-2222-4222-8222-222222222222' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gpm-backend:3008/api/v1/templates/defaults/PASSWORD_RECOVERY/EMAIL',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-api-key': 'secret' }),
      }),
    );
  });

  it('lança NoDefaultTemplateError em 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        code: 'NO_DEFAULT_TEMPLATE',
        message: 'Template default nao encontrado',
      }),
    });
    await expect(
      service.resolve({ scope: 'GPM', type: 'WELCOME', channelType: 'EMAIL' }),
    ).rejects.toBeInstanceOf(NoDefaultTemplateError);
  });

  it('rejeita scope=TENANT (fase 1 só GPM)', async () => {
    await expect(
      service.resolve({
        scope: 'TENANT',
        tenantCode: 'abc',
        type: 'WELCOME',
        channelType: 'EMAIL',
      }),
    ).rejects.toThrow(/TENANT.*não suportado/);
  });

  it('exige templateId ou type', async () => {
    await expect(
      service.resolve({ scope: 'GPM', channelType: 'EMAIL' }),
    ).rejects.toThrow(/templateId ou type/);
  });

  it('lança Error genérico em 5xx do gpm-backend', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });
    await expect(
      service.resolve({ scope: 'GPM', type: 'PASSWORD_RECOVERY', channelType: 'EMAIL' }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
