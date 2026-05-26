import type { compile as CompileFn } from '../lib/handlebars-singleton.js';

export interface TemplateInput {
  subject: string;
  body: string;
}

export interface RenderedTemplate {
  subject: string;
  body: string;
}

/**
 * Renderiza templates Handlebars em modo strict (lanca se faltar variavel).
 *
 * Aplica o mesmo contexto de dados para subject e body, garantindo
 * consistencia entre o assunto do email e o HTML renderizado.
 */
export class TemplateRenderService {
  constructor(private readonly deps: { compile: typeof CompileFn }) {}

  render(template: TemplateInput, data: Record<string, unknown>): RenderedTemplate {
    const renderSubject = this.deps.compile(template.subject, { strict: true });
    const renderBody = this.deps.compile(template.body, { strict: true });
    return {
      subject: renderSubject(data),
      body: renderBody(data),
    };
  }
}
