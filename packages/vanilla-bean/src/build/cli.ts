#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build, createServer, loadConfigFromFile, preview } from 'vite';
import framework from './vite/index.ts';
import { prerender } from './ssr.ts';
import { c, brand, assetTable, VERSION } from '../log.ts';

const root = process.cwd();
const cmd = process.argv[2];

function patchDevOutput(): void {
  const orig = process.stdout.write.bind(process.stdout);
  let last: { file: string | null; t: number } = { file: null, t: 0 };
  (process.stdout as any).write = (chunk: any, ...args: any[]) => {
    if (typeof chunk === 'string') {
      const plain = chunk.replace(/\x1b\[[0-9;]*m/g, '');
      const m = plain.match(/\[vite\].*?(hmr update|page reload)\s+(.+?)(?:\s*\(x\d+\))?\s*$/m);
      if (m) {
        const file = m[2].trim();
        const now = Date.now();
        if (file === last.file && now - last.t < 250) return true;
        last = { file, t: now };
        const label = m[1] === 'page reload' ? 'reload' : 'hmr';
        chunk = `  ${c.dim(new Date().toLocaleTimeString())}  ${c.magenta(label)} ${c.bold(file)}\n`;
      }
    }
    return orig(chunk, ...args);
  };
}

async function loadConfig(): Promise<any> {
  for (const ext of ['ts', 'js', 'mjs']) {
    const file = path.join(root, `vanilla-bean.config.${ext}`);
    if (!fs.existsSync(file)) continue;
    const loaded = await loadConfigFromFile(
      {
        command: cmd === 'dev' ? 'serve' : 'build',
        mode: process.env.NODE_ENV || (cmd === 'dev' ? 'development' : 'production')
      },
      file,
      root,
      'silent'
    );
    return loaded?.config || {};
  }
  return {};
}

function viteConfig(site: any, logLevel: any = 'silent'): any {
  const userVite = site.vite || {};
  return {
    root,
    configFile: false,
    logLevel,
    ...userVite,
    plugins: [framework(site), ...(userVite.plugins || [])]
  };
}

function ssrViteConfig(site: any): any {
  const userVite = site.vite || {};
  return {
    root,
    configFile: false,
    logLevel: 'silent',
    ...userVite,
    plugins: [framework(site, { ssrBuild: true }), ...(userVite.plugins || [])]
  };
}

async function dev(site: any): Promise<void> {
  patchDevOutput();
  const server = await createServer(viteConfig(site, 'info'));
  await server.listen();
  process.stdout.write(brand('dev', server.resolvedUrls?.local?.[0]) + '\n');
}

async function previewCmd(site: any): Promise<void> {
  const server = await preview(viteConfig(site, 'info'));
  process.stdout.write(brand('preview', server.resolvedUrls?.local?.[0]));
}

async function buildClient(site: any): Promise<void> {
  const t = Date.now();
  const out = await build(viteConfig(site));
  process.stdout.write(assetTable(out) + '\n\n');
  process.stdout.write(`  ${c.green(c.bold('✓'))} ${c.dim('client built in ' + (Date.now() - t) + 'ms')}\n`);
  fs.mkdirSync(path.join(root, '.vanilla/server'), { recursive: true });
  fs.copyFileSync(path.join(root, '.vanilla/dist/index.html'), path.join(root, '.vanilla/server/shell.html'));
  await prerender({ root, outDir: '.vanilla/dist', plugins: viteConfig(site).plugins });
}

async function buildServer(site: any): Promise<void> {
  const t = Date.now();
  const serverDir = path.join(root, '.vanilla/server');
  if (fs.existsSync(serverDir)) for (const f of fs.readdirSync(serverDir)) if (f.endsWith('.js')) fs.rmSync(path.join(serverDir, f));
  fs.rmSync(path.join(root, '.vanilla/index.js'), { force: true });
  await build(ssrViteConfig(site));
  fs.writeFileSync(
    path.join(root, '.vanilla', 'package.json'),
    JSON.stringify({ type: 'module', main: 'index.js', version: VERSION }, null, 2) + '\n'
  );
  process.stdout.write(`\n  ${c.green(c.bold('✓'))} ${c.dim('ssr server → .vanilla/index.js  (' + (Date.now() - t) + 'ms)')}\n`);
}

async function buildCmd(site: any): Promise<void> {
  const t = Date.now();
  process.stdout.write(brand('build') + '\n');
  await buildClient(site);
  await buildServer(site);
  process.stdout.write(`  ${c.green(c.bold('✓'))} ${c.green(c.bold('build complete!'))} ${c.dim('in ' + (Date.now() - t) + 'ms')}\n`);
}
async function buildClientCmd(site: any): Promise<void> {
  process.stdout.write(brand('build:client') + '\n');
  await buildClient(site);
}

const mtime = (p: string): number => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
function newestMtime(dir: string): number {
  let newest = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(full) : mtime(full));
  }
  return newest;
}
function buildIsStale(): boolean {
  const marker = path.join(root, '.vanilla/index.js');
  if (!fs.existsSync(marker) || !fs.existsSync(path.join(root, '.vanilla/dist/index.html'))) return true;
  const builtAt = mtime(marker);
  const srcAt = Math.max(
    newestMtime(path.join(root, 'src')),
    mtime(path.join(root, 'vanilla-bean.config.js')),
    mtime(path.join(root, 'package.json'))
  );
  return srcAt > builtAt;
}

function currentRuntime(): string {
  const g = globalThis as any;
  if (g.Ant || process.versions.ant) return 'ant';
  if (g.Bun || process.versions.bun) return 'bun';
  if (g.Deno || process.versions.deno) return 'deno';
  return 'node';
}

function hasBin(bin: string): boolean {
  try {
    execSync((process.platform === 'win32' ? 'where ' : 'command -v ') + bin, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function pickRuntime(site: any): string {
  const want = process.env.VANILLA_RUNTIME || site.runtime;
  if (want) return want;
  const cur = currentRuntime();
  if (cur !== 'node') return cur;
  for (const rt of ['ant', 'bun', 'deno']) if (hasBin(rt)) return rt;
  return 'node';
}

function launcher(rt: string, port: string): { cmd: string; args: string[] } | null {
  switch (rt) {
    case 'node':
      return null;
    case 'ant':
      return { cmd: 'ant', args: ['.vanilla'] };
    case 'bun':
      return { cmd: 'bun', args: ['.vanilla/index.js'] };
    case 'deno':
      return { cmd: 'deno', args: ['serve', '-A', '--port', port, '.vanilla/index.js'] };
    default:
      return { cmd: rt, args: ['.vanilla/index.js'] };
  }
}

function nodeToWebRequest(req: any): Promise<Request> {
  const url = 'http://' + (req.headers.host || 'localhost') + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : (v as string));
  const method = req.method || 'GET';
  if (method === 'GET' || method === 'HEAD') return Promise.resolve(new Request(url, { method, headers }));
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', (ch: Buffer) => chunks.push(ch));
    req.on('end', () => resolve(new Request(url, { method, headers, body: Buffer.concat(chunks), duplex: 'half' } as any)));
  });
}

async function serveNode(): Promise<void> {
  const { createServer } = await import('node:http');
  const mod = await import(pathToFileURL(path.join(root, '.vanilla/index.js')).href);
  const { fetch: handler, port } = mod.default;
  createServer(async (req: any, res: any) => {
    try {
      const response: Response = await handler(await nodeToWebRequest(req), {});
      res.statusCode = response.status;
      response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
      if (response.body) {
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.end(Buffer.from(await response.arrayBuffer()));
      }
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  }).listen(Number(port));
}

async function startCmd(site: any): Promise<void> {
  if (buildIsStale()) await buildCmd(site);
  const rt = pickRuntime(site);
  const spec = launcher(rt, process.env.PORT || '9454');
  if (!spec) return serveNode();
  const child = spawn(spec.cmd, spec.args, { stdio: 'inherit', env: { ...process.env } });
  let killed = false;
  const stop = () => {
    if (killed) return;
    killed = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', e => {
    console.error(`  ${c.red('✗')} could not launch ${rt}: ${e.message}`);
    process.exit(1);
  });
}

const commands: Record<string, (site: any) => Promise<void>> = {
  dev,
  preview: previewCmd,
  build: buildCmd,
  'build:client': buildClientCmd,
  start: startCmd
};
const action = commands[cmd!];
if (!action) {
  console.log(`usage: ${c.bold('vanilla-bean')} ${c.dim('<dev | build | build:client | preview | start>')}`);
  process.exit(1);
}
action(await loadConfig()).catch(e => {
  console.error(e);
  process.exit(1);
});
