/**
 * Reading esbuild metafiles: which packages contributed how many bytes, and what a treatment
 * build added over its baseline (feature group G3, doc 08 §3).
 */
import type { Metafile } from 'esbuild';

/** Package name for a module path inside node_modules (handles scopes and nested node_modules). */
export function packageOfPath(path: string): string | null {
  const p = path.replace(/\\/g, '/');
  const idx = p.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = p.slice(idx + 'node_modules/'.length).split('/');
  if (rest[0]?.startsWith('@')) return rest[1] ? `${rest[0]}/${rest[1]}` : null;
  return rest[0] ?? null;
}

/** Host application code, as opposed to a package from node_modules. */
export const APP_PACKAGE = '(app)';

export const packageOf = (path: string): string => packageOfPath(path) ?? APP_PACKAGE;

/**
 * Output files the browser loads for the initial render: the entry chunk, everything it reaches
 * through static `import` statements, and any CSS. Dynamic imports are excluded — that is exactly
 * what makes the `lazy` placement cheap at load (FR-14).
 */
export function initialOutputs(meta: Metafile): Set<string> {
  const keys = Object.keys(meta.outputs).filter((k) => !k.endsWith('.map'));
  const entry = keys.find((k) => meta.outputs[k]!.entryPoint !== undefined && k.endsWith('.js'));
  const initial = new Set<string>();
  if (entry) {
    const stack = [entry];
    while (stack.length) {
      const k = stack.pop()!;
      if (initial.has(k)) continue;
      initial.add(k);
      for (const imp of meta.outputs[k]!.imports) {
        if (imp.kind === 'import-statement' && !imp.external) stack.push(imp.path);
      }
    }
  }
  for (const k of keys) if (k.endsWith('.css')) initial.add(k);
  return initial;
}

export interface MetafileBreakdown {
  /** Bytes contributed to the initial JS outputs, per package. */
  packageBytes: Map<string, number>;
  /** Module count across the initial JS outputs. */
  modules: number;
  /** Share of initial bytes that came from CommonJS-wrapped modules (`iso_cjs_byte_share`). */
  cjsByteShare: number;
  /** Non-initial JS output bytes — the lazily loaded part. */
  lazyBytes: number;
  /** Number of distinct JS output chunks in the initial load. */
  initialChunks: number;
}

/**
 * Per-package byte attribution over a metafile's initial load.
 *
 * `format` on a metafile input is how esbuild records whether it wrapped a module as CommonJS.
 * It is absent for modules esbuild did not need to classify, which are counted as non-CJS rather
 * than guessed.
 */
export function breakdown(meta: Metafile): MetafileBreakdown {
  const initial = initialOutputs(meta);
  const packageBytes = new Map<string, number>();
  let modules = 0;
  let cjsBytes = 0;
  let totalBytes = 0;
  let initialChunks = 0;

  for (const key of initial) {
    if (!key.endsWith('.js')) continue;
    initialChunks++;
    for (const [inputPath, info] of Object.entries(meta.outputs[key]!.inputs)) {
      modules++;
      const name = packageOf(inputPath);
      packageBytes.set(name, (packageBytes.get(name) ?? 0) + info.bytesInOutput);
      totalBytes += info.bytesInOutput;
      if (meta.inputs[inputPath]?.format === 'cjs') cjsBytes += info.bytesInOutput;
    }
  }

  let lazyBytes = 0;
  for (const [key, out] of Object.entries(meta.outputs)) {
    if (!key.endsWith('.js') || initial.has(key)) continue;
    lazyBytes += out.bytes;
  }

  return {
    packageBytes,
    modules,
    cjsByteShare: totalBytes > 0 ? cjsBytes / totalBytes : 0,
    lazyBytes,
    initialChunks,
  };
}

/** Distinct npm packages in a metafile's initial load (the app's own code excluded). */
export function packagesIn(meta: Metafile): string[] {
  return [...breakdown(meta).packageBytes.keys()].filter((n) => n !== APP_PACKAGE).sort();
}

export interface PackageDiff {
  /** Packages in the treatment's initial load that the baseline did not have. */
  added: string[];
  /** Packages the baseline already had — the candidate gets these for free (the context effect). */
  shared: string[];
  /** Packages whose byte contribution grew, with the delta. */
  grew: { name: string; deltaBytes: number }[];
  deltaModules: number;
  deltaChunks: number;
}

/**
 * What a treatment build added over its baseline, per package.
 *
 * `candidatePackages` — the packages the candidate import actually needs, learnt from an isolated
 * build — is what makes `shared` meaningful: without it we could only say which packages are new,
 * not which of the candidate's own dependencies the app already shipped.
 */
export function diffMetafiles(baseline: Metafile, treatment: Metafile, candidatePackages?: readonly string[]): PackageDiff {
  const base = breakdown(baseline);
  const treat = breakdown(treatment);
  const added: string[] = [];
  const grew: { name: string; deltaBytes: number }[] = [];

  for (const [name, bytes] of treat.packageBytes) {
    if (name === APP_PACKAGE) continue;
    const before = base.packageBytes.get(name);
    if (before === undefined) added.push(name);
    else if (bytes > before) grew.push({ name, deltaBytes: bytes - before });
  }

  const shared = (candidatePackages ?? []).filter((n) => base.packageBytes.has(n));

  return {
    added: added.sort(),
    shared: [...shared].sort(),
    grew: grew.sort((a, b) => b.deltaBytes - a.deltaBytes),
    deltaModules: treat.modules - base.modules,
    deltaChunks: treat.initialChunks - base.initialChunks,
  };
}
