import { describe, expect, it } from 'vitest';
import { TemplateRenderService } from './template-render-service.js';
import { compile } from '../lib/handlebars-singleton.js';

describe('TemplateRenderService', () => {
  const service = new TemplateRenderService({ compile });

  it('renders variables in subject and body', () => {
    const out = service.render(
      {
        subject: 'Olá {{name}}',
        body: '<p>Bem-vindo, {{name}}!</p>',
      },
      { name: 'Maria' },
    );
    expect(out.subject).toBe('Olá Maria');
    expect(out.body).toBe('<p>Bem-vindo, Maria!</p>');
  });

  it('supports conditionals and loops', () => {
    const out = service.render(
      {
        subject: 'Pedido',
        body: '{{#if items}}{{#each items}}{{this}},{{/each}}{{/if}}',
      },
      { items: ['A', 'B'] },
    );
    expect(out.body).toBe('A,B,');
  });

  it('throws on missing variable in strict mode', () => {
    expect(() =>
      service.render({ subject: '{{missing}}', body: 'x' }, {}),
    ).toThrow();
  });
});
