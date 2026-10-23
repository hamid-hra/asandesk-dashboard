// آزمون‌ها در Node: importهای بدون پسوند (مثل Vite) و `?raw` برای فایل‌های .proto
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?raw')) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    const ours = context.parentURL && !context.parentURL.includes('/node_modules/');
    if (ours && (specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('?raw')) {
      const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  },
});
