/**
 * Framework detection from a declared dependency list (FR-03).
 *
 * The framework is a feature of the host app (group G5, doc 08 §3) and it decides which candidates
 * are even applicable — a Vue plugin cannot be measured in a React app, so the compatibility matrix
 * is built from this (doc 07 §5).
 */
export type Framework = 'next' | 'nuxt' | 'sveltekit' | 'svelte' | 'vue' | 'solid' | 'preact' | 'react' | 'vanilla';

/**
 * Order matters: a Next.js app also depends on `react`, and a SvelteKit app on `svelte`, so the more
 * specific meta-framework has to be checked first or every Next app would be reported as plain React.
 */
const SIGNALS: [string, Framework][] = [
  ['next', 'next'],
  ['nuxt', 'nuxt'],
  ['@sveltejs/kit', 'sveltekit'],
  ['svelte', 'svelte'],
  ['vue', 'vue'],
  ['solid-js', 'solid'],
  ['preact', 'preact'],
  ['react', 'react'],
];

export function detectFramework(deps: Record<string, string>): Framework {
  for (const [name, framework] of SIGNALS) {
    if (Object.prototype.hasOwnProperty.call(deps, name)) return framework;
  }
  return 'vanilla';
}

/** Dependency names and ranges a `package.json` declares in `dependencies`. */
export function declaredDependencies(manifest: unknown): Record<string, string> {
  const deps = (manifest as { dependencies?: unknown } | null)?.dependencies;
  if (typeof deps !== 'object' || deps === null) return {};
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
    if (typeof range === 'string') out[name] = range;
  }
  return out;
}
