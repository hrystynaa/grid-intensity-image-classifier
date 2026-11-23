import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function bundle(entry, options = {}) {
  const result = await build({
    entryPoints: [resolve(appDir, entry)],
    bundle: true,
    minify: true,
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    target: ['chrome110', 'edge110', 'firefox115'],
    logLevel: 'warning',
    ...options,
  });
  return result.outputFiles[0].text;
}

// Worker code is embedded as text so the app still opens from file:// without a server.
export async function workerDefines() {
  const [featureWorker, modelWorker] = await Promise.all([
    bundle('src/workers/featureWorker.js', { format: 'iife' }),
    bundle('src/workers/modelWorker.js', { format: 'iife' }),
  ]);
  return {
    __FEATURE_WORKER_SOURCE__: JSON.stringify(featureWorker),
    __MODEL_WORKER_SOURCE__: JSON.stringify(modelWorker),
  };
}
