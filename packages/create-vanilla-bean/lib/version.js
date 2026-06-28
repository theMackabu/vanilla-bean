export async function fetchFrameworkVersion(registry = process.env.npm_config_registry || 'https://registry.npmjs.org') {
  const base = registry.replace(/\/+$/, '');
  const res = await fetch(`${base}/vanilla-bean`);
  if (!res.ok) throw new Error(`registry returned ${res.status} ${res.statusText}`);

  const pkg = await res.json();
  return latestVersion(Object.keys(pkg?.versions || {}));
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return null;
  return {
    version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  };
}

function comparePrerelease(a, b) {
  if (!a.length && b.length) return 1;
  if (a.length && !b.length) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;

    const an = /^\d+$/.test(a[i]) ? Number(a[i]) : null;
    const bn = /^\d+$/.test(b[i]) ? Number(b[i]) : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return a[i] < b[i] ? -1 : 1;
  }

  return 0;
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function latestVersion(versions) {
  const parsed = versions.map(parseVersion).filter(Boolean);
  parsed.sort(compareVersions);
  const latest = parsed.at(-1)?.version;
  if (!latest) throw new Error('registry response has no valid vanilla-bean versions');
  return latest;
}
