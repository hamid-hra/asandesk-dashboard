// آزمون‌ها در Node: importهای بدون پسوند (مثل Vite) و `?raw` برای فایل‌های .proto
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSchema } from '../proto/schema.mjs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'virtual:asan-proto-schema') return { url: 'asan:proto-schema', shortCircuit: true };
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
    if (url === 'asan:proto-schema') {
      return { format: 'module', source: `export default ${JSON.stringify(buildSchema())};`, shortCircuit: true };
    }
    if (url.endsWith('.json') && !url.includes('/node_modules/')) {
      return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
    }
    if (url.endsWith('?raw')) {
      const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  },
});
