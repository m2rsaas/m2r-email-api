import Handlebars from 'handlebars';

const instance = Handlebars.create();

instance.registerHelper('upper', (s: unknown) => String(s ?? '').toUpperCase());
instance.registerHelper('lower', (s: unknown) => String(s ?? '').toLowerCase());

export { instance as handlebars };

export interface RenderOptions {
  strict?: boolean;
}

export function compile(template: string, options: RenderOptions = {}): (data: Record<string, unknown>) => string {
  const compiled = instance.compile(template, {
    strict: options.strict ?? true,
    noEscape: false,
    preventIndent: false,
  });
  return (data) => compiled(data);
}
