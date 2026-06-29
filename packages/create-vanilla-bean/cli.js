#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import * as p from '@clack/prompts';
import { scaffold } from './lib/scaffold.js';
import { spawnSync } from 'node:child_process';
import { blue, yellow } from './lib/colors.js';
import { multiselect, select } from './lib/prompts.js';
import { fetchFrameworkVersion } from './lib/version.js';
import { featureOptions, packageOptions } from './lib/addons.js';
import { formatPathForMessage, resolveProjectName, validateProjectPath } from './lib/paths.js';

function isEmptyDir(dir) {
  return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function detectPackageManager() {
  const agent = process.env.npm_config_user_agent?.split(' ')[0]?.split('/')[0];
  if (['ant', 'bun', 'deno', 'npm', 'pnpm', 'yarn'].includes(agent)) return agent;
  return 'npm';
}

function installCommand(packageManager) {
  if (packageManager === 'yarn') return ['yarn'];
  return [packageManager, 'install'];
}

function devCommand(packageManager) {
  switch (packageManager) {
    case 'deno':
      return ['deno', 'task', 'dev'];
    case 'npm':
      return ['npm', 'run', 'dev'];
    default:
      return [packageManager, 'dev'];
  }
}

function runCommand(command, cwd) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}

function shellCommand(command) {
  return command.join(' ');
}

function cdCommand(dest) {
  const rel = formatPathForMessage(dest);
  if (rel === '.') return null;
  return `cd ${rel.includes(' ') ? JSON.stringify(rel) : rel}`;
}

function nextSteps(dest, packageManager) {
  return [cdCommand(dest), shellCommand(installCommand(packageManager)), shellCommand(devCommand(packageManager))]
    .filter(Boolean)
    .map(command => `  ${command}`)
    .join('\n');
}

async function main() {
  const projectPathArg = process.argv[2];

  const projectPath =
    projectPathArg ??
    (await p.text({
      message: 'Project name:',
      placeholder: 'vanilla-bean-project',
      defaultValue: 'vanilla-bean-project',
      validate: validateProjectPath
    }));

  if (p.isCancel(projectPath)) return p.cancel('cancelled');
  const projectPathError = validateProjectPath(projectPath);
  if (projectPathError) return p.cancel(projectPathError);

  const dest = path.resolve(process.cwd(), projectPath);
  const name = resolveProjectName({ dest });
  if (!name) return p.cancel('project path must include a directory name');

  if (!isEmptyDir(dest)) {
    const action = await select({
      message:
        dest === process.cwd()
          ? 'Current directory is not empty. Please choose how to proceed:'
          : `Target directory "${formatPathForMessage(dest)}" is not empty. Please choose how to proceed:`,
      options: [
        { value: 'cancel', label: 'Cancel operation' },
        { value: 'remove', label: 'Remove existing files and continue' },
        { value: 'ignore', label: 'Ignore files and continue' }
      ]
    });
    if (p.isCancel(action) || action === 'cancel') return p.cancel('cancelled');
    if (action === 'remove') emptyDir(dest);
  }

  const lang = await select({
    message: 'Language?',
    options: [
      { value: 'ts', label: blue('TypeScript') },
      { value: 'js', label: yellow('JavaScript') }
    ]
  });

  if (p.isCancel(lang)) return p.cancel('cancelled');
  const packages = await multiselect({
    message: 'Select packages:',
    options: packageOptions,
    initialValues: ['tailwind'],
    required: false
  });
  if (p.isCancel(packages)) return p.cancel('cancelled');
  const features = await multiselect({
    message: 'Select features:',
    options: featureOptions,
    initialValues: ['path-alias'],
    required: false
  });
  if (p.isCancel(features)) return p.cancel('cancelled');

  const packageManager = detectPackageManager();
  const installAndStart = await p.confirm({
    message: `Install with ${packageManager} and start now?`,
    initialValue: false
  });
  if (p.isCancel(installAndStart)) return p.cancel('cancelled');

  let vanillaBeanVersion;
  try {
    vanillaBeanVersion = await fetchFrameworkVersion();
  } catch (e) {
    return p.cancel(`could not resolve latest vanilla-bean version: ${e.message}`);
  }

  p.log.step(`Scaffolding project in ${dest}...`);
  scaffold({ dest, name, ts: lang === 'ts', packages, features, vanillaBeanVersion });

  if (installAndStart) {
    p.log.step(`Installing dependencies with ${packageManager}...`);
    runCommand(installCommand(packageManager), dest);
    p.log.step('Starting dev server...');
    runCommand(devCommand(packageManager), dest);
    return;
  }

  p.outro(`Done. Now run:\n\n${nextSteps(dest, packageManager)}`);
}

main();
