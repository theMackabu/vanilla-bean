import path from 'node:path';

const invalidProjectPath = 'letters, numbers, dot, dash, underscore and slash only';

export function formatPathForMessage(dest) {
  const rel = path.relative(process.cwd(), dest);
  if (!rel) return '.';
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : dest;
}

export function validateProjectPath(v) {
  return v && /[^a-zA-Z0-9._/-]/.test(v) ? invalidProjectPath : undefined;
}

function projectNameFromDest(dest) {
  return path.basename(path.resolve(dest));
}

export function resolveProjectName({ dest, name }) {
  return name && name !== '.' ? name : projectNameFromDest(dest);
}
