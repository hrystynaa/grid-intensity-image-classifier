// Bundles the application into a single HTML file that opens without a server.
// Usage: node build.mjs [--open]

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const appDir = dirname(fileURLToPath(import.meta.url));
const outFile = join(appDir, 'dist', 'index.html');

async function bundle(entry, options = {}) {
  const result = await build({
    entryPoints: [join(appDir, entry)],
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

function openInBrowser(path) {
  const commands = {
    win32: ['cmd', ['/c', 'start', '', path]],
    darwin: ['open', [path]],
  };
  const [command, args] = commands[process.platform] ?? ['xdg-open', [path]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

const [template, script, styles] = await Promise.all([
  readFile(join(appDir, 'src', 'index.html'), 'utf8'),
  bundle('src/main.js', { format: 'iife' }),
  bundle('src/styles.css'),
]);

const html = template
  .replace('<!--STYLES-->', () => `<style>${styles}</style>`)
  .replace('<!--SCRIPT-->', () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(`Built ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

if (process.argv.includes('--open')) openInBrowser(outFile);
