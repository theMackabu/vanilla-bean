#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as p from "@clack/prompts";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(here, "template");

const tsOnly = new Set(["tsconfig.json", "src/app.d.ts"]);
const tailwindOnly = new Set(["src/assets/index.css"]);
const invalidProjectPath = "letters, numbers, dot, dash, underscore and slash only";

function validateProjectPath(v) {
  return v && /[^a-zA-Z0-9._/-]/.test(v) ? invalidProjectPath : undefined;
}

function formatPathForMessage(dest) {
  const rel = path.relative(process.cwd(), dest);
  if (!rel) return ".";
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : dest;
}

export function scaffold({ dest, name, ts, tailwind }) {
  const tokens = {
    name,
    x: ts ? "tsx" : "jsx",
    configExt: ts ? "ts" : "js",
    tw_import: tailwind ? 'import tailwindcss from "@tailwindcss/vite";\n\n' : "",
    tw_plugin: tailwind ? "\n  vite: { plugins: [tailwindcss()] }," : "",
    tw_css: tailwind ? 'import "./assets/index.css";\n' : "",
    children_t: ts ? ": { children?: unknown }" : "",
  };
  const fill = (s) => s.replace(/{{(\w+)}}/g, (m, k) => (k in tokens ? tokens[k] : m));

  const rename = (rel) => {
    let out = rel === "_gitignore" ? ".gitignore" : rel;
    if (out.endsWith(".jsx")) out = out.slice(0, -4) + (ts ? ".tsx" : ".jsx");
    else if (out.endsWith(".js")) out = out.slice(0, -3) + (ts ? ".ts" : ".js");
    return out;
  };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(templateDir, abs).split(path.sep).join("/");
      if (!ts && tsOnly.has(rel)) continue;
      if (!tailwind && tailwindOnly.has(rel)) continue;

      const outAbs = path.join(dest, rename(rel));
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });

      if (rel === "package.json") {
        const pkg = JSON.parse(fs.readFileSync(abs, "utf8"));
        pkg.name = name;
        if (ts) pkg.scripts.typecheck = "tsc --noEmit";
        const dev = {
          ...(tailwind ? { "@tailwindcss/vite": "^4.0.0" } : {}),
          ...(ts ? { typescript: "^5.7.0" } : {}),
        };
        if (Object.keys(dev).length) pkg.devDependencies = dev;
        fs.writeFileSync(outAbs, JSON.stringify(pkg, null, 2) + "\n");
      } else {
        fs.writeFileSync(outAbs, fill(fs.readFileSync(abs, "utf8")));
      }
    }
  };

  walk(templateDir);
  return dest;
}

async function main() {
  p.intro("🫘 create vanilla bean");
  const projectPathArg = process.argv[2];

  const projectPath =
    projectPathArg ??
    (await p.text({
      message: "Project path? (type . for current directory)",
      placeholder: "my-vanilla-bean-app",
      defaultValue: "my-vanilla-bean-app",
      validate: validateProjectPath,
    }));

  if (p.isCancel(projectPath)) return p.cancel("cancelled");
  const projectPathError = validateProjectPath(projectPath);
  if (projectPathError) return p.cancel(projectPathError);

  const dest = path.resolve(process.cwd(), projectPath);
  const name = path.basename(dest);
  if (!name) return p.cancel("project path must include a directory name");

  const lang = await p.select({
    message: "Language?",
    options: [
      { value: "ts", label: "TypeScript" },
      { value: "js", label: "JavaScript" },
    ],
  });

  if (p.isCancel(lang)) return p.cancel("cancelled");
  const tailwind = await p.confirm({ message: "Add Tailwind CSS?", initialValue: true });
  if (p.isCancel(tailwind)) return p.cancel("cancelled");

  if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
    return p.cancel(`${formatPathForMessage(dest)} already exists and is not empty`);
  }

  scaffold({ dest, name, ts: lang === "ts", tailwind });
  const cd = formatPathForMessage(dest);

  p.note(`${cd === "." ? "" : `cd ${cd}\n`}ant install\nant dev`, "next steps");
  p.outro("happy hacking 🫘");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
