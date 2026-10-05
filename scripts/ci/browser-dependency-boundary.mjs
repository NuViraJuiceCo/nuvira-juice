import fs from 'node:fs';
import path from 'node:path';

export function verifyException(policy, lock, now = new Date()) {
  const created = Date.parse(policy.created_at);
  const expires = Date.parse(policy.expires_at);
  if (policy.scope !== 'website-only' || !policy.approved_by
    || !Number.isFinite(created) || !Number.isFinite(expires)
    || created > now.getTime() || expires <= now.getTime()
    || expires <= created || expires - created > 30 * 86400000) {
    throw new Error('Website dependency exception is invalid or expired; review required.');
  }
  for (const [name, version] of Object.entries(policy.reviewed_versions)) {
    const entries = Object.entries(lock.packages).filter(([key]) =>
      `/${key}`.endsWith(`/node_modules/${name}`));
    if (!entries.length || entries.some(([, entry]) => entry.version !== version)) {
      throw new Error(`Website dependency exception requires version review: ${name}`);
    }
  }
}

export function verifyBrowserModules(bundle, excludedPackages) {
  const found = new Set();
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const id of Object.keys(chunk.modules)) {
      const normalized = id.replaceAll('\\', '/');
      for (const name of excludedPackages) {
        if (normalized.includes(`/node_modules/${name}/`)) found.add(name);
      }
    }
  }
  if (found.size) throw new Error(`Excluded dependencies entered browser output: ${[...found].sort().join(', ')}`);
}

// This validates web output only; it is not authorization for a native/backend release.
export function browserDependencyBoundary() {
  let root;
  let policy;
  return {
    name: 'website-dependency-boundary',
    apply: 'build',
    configResolved(config) { root = config.root; },
    buildStart() {
      policy = JSON.parse(fs.readFileSync(path.join(root, 'config/release/website-dependency-exception.json'), 'utf8'));
      const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
      verifyException(policy, lock);
    },
    generateBundle(_options, bundle) {
      verifyBrowserModules(bundle, policy.excluded_browser_packages);
    },
  };
}
