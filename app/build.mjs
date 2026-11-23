// Bundles the application into a single HTML file that opens without a server.
// Usage: node build.mjs [--open]

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { appDir, bundle, workerDefines } from './scripts/bundle.mjs';

const outFile = join(appDir, 'dist', 'index.html');

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
  bundle('src/main.js', { format: 'iife', define: await workerDefines() }),
  bundle('src/styles.css'),
]);

const html = template
  .replace('<!--STYLES-->', () => `<style>${styles}</style>`)
  .replace('<!--SCRIPT-->', () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(`Built ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

if (process.argv.includes('--open')) openInBrowser(outFile);
