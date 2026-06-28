import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addonFiles, addonPackageJson, normalizeFeatures, normalizePackages } from './addons.js';
import { resolveProjectName } from './paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(here, '..', 'template');
const addonsDir = path.join(here, '..', 'addons');

const tsOnly = new Set(['tsconfig.json', 'src/app.d.ts']);

export function scaffold({ dest, name, ts, tailwind, packages, features, vanillaBeanVersion }) {
  const projectName = resolveProjectName({ dest, name });
  if (!projectName) throw new Error('project path must include a directory name');
  if (!vanillaBeanVersion) throw new Error('vanilla-bean version is required');
  const selectedPackages = normalizePackages({ packages, tailwind });
  const selectedFeatures = normalizeFeatures({ features });
  const hasTailwind = selectedPackages.has('tailwind');
  const hasPathAlias = selectedFeatures.has('path-alias');
  const viteEntries = [
    hasTailwind && '    plugins: [tailwindcss()]',
    hasPathAlias &&
      '    resolve: {\n      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }\n    }'
  ].filter(Boolean);

  const tokens = {
    name: projectName,
    x: ts ? 'tsx' : 'jsx',
    configExt: ts ? 'ts' : 'js',
    alias_import: hasPathAlias ? 'import { fileURLToPath, URL } from "node:url";\n' : '',
    tw_import: hasTailwind ? 'import tailwindcss from "@tailwindcss/vite";\n\n' : '',
    vite_config: viteEntries.length ? `\n  vite: {\n${viteEntries.join(',\n')}\n  },` : '',
    ts_alias: hasPathAlias
      ? ',\n    "baseUrl": ".",\n    "paths": {\n      "@/*": ["src/*"]\n    }'
      : '',
    tw_css: hasTailwind ? 'import "./assets/index.css";\n' : '',
    children_t: ts ? ': { children?: unknown }' : ''
  };
  const fill = s => s.replace(/{{(\w+)}}/g, (m, k) => (k in tokens ? tokens[k] : m));

  const rename = rel => {
    let out = rel === '_gitignore' ? '.gitignore' : rel;
    if (out.endsWith('.jsx')) out = out.slice(0, -4) + (ts ? '.tsx' : '.jsx');
    else if (out.endsWith('.js')) out = out.slice(0, -3) + (ts ? '.ts' : '.js');
    return out;
  };

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(templateDir, abs).split(path.sep).join('/');
      if (!ts && tsOnly.has(rel)) continue;

      const outAbs = path.join(dest, rename(rel));
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });

      if (rel === 'package.json') {
        const pkg = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const addons = addonPackageJson({ selectedPackages, ts });
        pkg.name = projectName;
        pkg.dependencies['vanilla-bean'] = vanillaBeanVersion;
        if (ts) pkg.scripts.typecheck = 'tsc --noEmit';
        pkg.scripts = {
          ...pkg.scripts,
          ...addons.scripts
        };
        const dev = {
          ...(ts ? { typescript: '^5.7.0' } : {}),
          ...(ts && hasPathAlias ? { '@types/node': '^22.10.2' } : {}),
          ...addons.devDependencies
        };
        if (Object.keys(dev).length) pkg.devDependencies = dev;
        fs.writeFileSync(outAbs, JSON.stringify(pkg, null, 2) + '\n');
      } else {
        fs.writeFileSync(outAbs, fill(fs.readFileSync(abs, 'utf8')));
      }
    }
  };

  walk(templateDir);
  for (const file of addonFiles({ selectedPackages, ts })) {
    const outAbs = path.join(dest, file.to);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.copyFileSync(path.join(addonsDir, file.from), outAbs);
  }
  return dest;
}
