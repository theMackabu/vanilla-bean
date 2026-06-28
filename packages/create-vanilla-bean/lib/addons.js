import { blue, blueBright, cyan, green, magenta, red, yellow } from './colors.js';

export const packageOptions = [
  { value: 'tailwind', label: cyan('Tailwind CSS'), hint: 'utility CSS' },
  { value: 'eslint', label: yellow('ESLint'), hint: 'linting' },
  { value: 'oxlint', label: blueBright('Oxlint'), hint: 'fast linting' },
  { value: 'prettier', label: magenta('Prettier'), hint: 'formatting' },
  { value: 'oxfmt', label: blue('Oxfmt'), hint: 'fast formatting' },
  { value: 'biome', label: green('Biome'), hint: 'linting + formatting' }
];

export const featureOptions = [{ value: 'path-alias', label: red('Path alias @/'), hint: 'map @/* to src/*' }];

export function normalizePackages({ packages, tailwind }) {
  return new Set(packages ?? (tailwind ? ['tailwind'] : []));
}

export function normalizeFeatures({ features }) {
  return new Set(features ?? []);
}

export function addonPackageJson({ selectedPackages, ts }) {
  const scripts = {};
  const devDependencies = {};

  if (selectedPackages.has('tailwind')) {
    devDependencies['@tailwindcss/vite'] = '^4.0.0';
  }

  if (selectedPackages.has('eslint')) {
    devDependencies['@eslint/js'] = '^9.0.0';
    devDependencies.eslint = '^9.0.0';
    if (ts) devDependencies['typescript-eslint'] = '^8.0.0';
  }

  if (selectedPackages.has('prettier')) {
    devDependencies.prettier = '^3.0.0';
  }

  if (selectedPackages.has('biome')) {
    devDependencies['@biomejs/biome'] = '^2.0.0';
  }

  if (selectedPackages.has('oxlint')) {
    devDependencies.oxlint = '^1.71.0';
  }

  if (selectedPackages.has('oxfmt')) {
    devDependencies.oxfmt = '^0.56.0';
  }

  const lintCommands = [
    selectedPackages.has('eslint') && 'eslint .',
    selectedPackages.has('oxlint') && 'oxlint',
    selectedPackages.has('biome') && 'biome lint .'
  ].filter(Boolean);
  if (lintCommands.length) scripts.lint = lintCommands.join(' && ');

  const formatCommands = [
    selectedPackages.has('prettier') && 'prettier --write .',
    selectedPackages.has('oxfmt') && 'oxfmt --write .',
    selectedPackages.has('biome') && 'biome format --write .'
  ].filter(Boolean);
  const formatCheckCommands = [
    selectedPackages.has('prettier') && 'prettier --check .',
    selectedPackages.has('oxfmt') && 'oxfmt --check .',
    selectedPackages.has('biome') && 'biome format .'
  ].filter(Boolean);
  if (formatCommands.length) scripts.format = formatCommands.join(' && ');
  if (formatCheckCommands.length) scripts['format:check'] = formatCheckCommands.join(' && ');

  if (selectedPackages.has('prettier')) {
    if (selectedPackages.has('biome')) scripts['format:biome'] = 'biome format --write .';
    if (selectedPackages.has('oxfmt')) scripts['format:oxfmt'] = 'oxfmt --write .';
  }

  return { scripts, devDependencies };
}

export function addonFiles({ selectedPackages, ts }) {
  return [
    selectedPackages.has('tailwind') && { from: 'tailwind/src/assets/index.css', to: 'src/assets/index.css' },
    selectedPackages.has('eslint') && { from: ts ? 'eslint/ts/eslint.config.js' : 'eslint/js/eslint.config.js', to: 'eslint.config.js' },
    selectedPackages.has('oxlint') && { from: ts ? 'oxlint/ts/.oxlintrc.json' : 'oxlint/js/.oxlintrc.json', to: '.oxlintrc.json' },
    selectedPackages.has('prettier') && { from: 'prettier/.prettierrc', to: '.prettierrc' },
    selectedPackages.has('prettier') && { from: 'prettier/.prettierignore', to: '.prettierignore' },
    selectedPackages.has('oxfmt') && { from: 'oxfmt/.oxfmtrc.json', to: '.oxfmtrc.json' },
    selectedPackages.has('biome') && { from: 'biome/biome.json', to: 'biome.json' }
  ].filter(Boolean);
}
