/**
 * `deplens-stats` — a Rollup/Vite plugin that records chunk → modules → rendered length
 * for a host build (doc 07 §2.3, doc 06 §2).
 *
 * We need three things the built files alone cannot tell us:
 *   1. which chunks the browser loads for the *initial* render (entry + static imports + their CSS),
 *   2. how many bytes of each output chunk came from each npm package (→ Δbytes per package, feature group G3),
 *   3. which chunks are lazy (`import()`), so the `lazy` placement can be verified (FR-14).
 *
 * The plugin is deliberately framework- and version-agnostic: it only touches the Rollup
 * `generateBundle` bundle object, so it can be handed to whichever Vite/Rollup version the
 * host app itself pins (see viteBuild.ts).
 */

/** Minimal structural types for the parts of the Rollup bundle we read. */
interface RenderedModule {
  renderedLength?: number;
  originalLength?: number;
}
interface OutputChunkLike {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  modules?: Record<string, RenderedModule>;
  /** Vite adds this: CSS files that this chunk needs. */
  viteMetadata?: { importedCss?: Set<string> | string[] };
}
interface OutputAssetLike {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}
type OutputLike = OutputChunkLike | OutputAssetLike;

export interface ModuleStat {
  /** Absolute module id, normalised to forward slashes. */
  id: string;
  renderedLength: number;
  originalLength: number;
}

export interface ChunkStat {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  /** Static chunk imports (these load together with the importer). */
  imports: string[];
  /** Dynamic chunk imports (`import()` — loaded later). */
  dynamicImports: string[];
  /** CSS files this chunk pulls in (Vite only). */
  importedCss: string[];
  codeBytes: number;
  modules: ModuleStat[];
}

export interface AssetStat {
  fileName: string;
  bytes: number;
}

export interface BundleStats {
  chunks: ChunkStat[];
  assets: AssetStat[];
}

export const STATS_FILE = 'deplens-stats.json';

const posix = (p: string) => p.replace(/\\/g, '/');

/** Collects the bundle stats and hands them to `onStats` (called once per output bundle). */
export function deplensStats(onStats: (stats: BundleStats) => void) {
  return {
    name: 'deplens-stats',
    // `generateBundle` runs after all transforms, with final file names and rendered code.
    generateBundle(_options: unknown, bundle: Record<string, OutputLike>) {
      const chunks: ChunkStat[] = [];
      const assets: AssetStat[] = [];
      for (const out of Object.values(bundle)) {
        if (out.type === 'chunk') {
          const css = out.viteMetadata?.importedCss;
          chunks.push({
            fileName: posix(out.fileName),
            isEntry: out.isEntry === true,
            isDynamicEntry: out.isDynamicEntry === true,
            imports: (out.imports ?? []).map(posix),
            dynamicImports: (out.dynamicImports ?? []).map(posix),
            importedCss: [...(css ?? [])].map(posix),
            codeBytes: Buffer.byteLength(out.code, 'utf8'),
            modules: Object.entries(out.modules ?? {}).map(([id, m]) => ({
              id: posix(id),
              renderedLength: m.renderedLength ?? 0,
              originalLength: m.originalLength ?? 0,
            })),
          });
        } else {
          const bytes = typeof out.source === 'string' ? Buffer.byteLength(out.source, 'utf8') : out.source.byteLength;
          assets.push({ fileName: posix(out.fileName), bytes });
        }
      }
      onStats({ chunks, assets });
    },
  };
}

/**
 * Output files the browser needs for the initial render: the entry chunk(s), everything they
 * reach through *static* chunk imports, and the CSS those chunks require. Dynamic imports are
 * excluded on purpose — that is what makes the `lazy` placement cheap at load time.
 */
export function initialFiles(stats: BundleStats): Set<string> {
  const byName = new Map(stats.chunks.map((c) => [c.fileName, c]));
  const initial = new Set<string>();
  const stack = stats.chunks.filter((c) => c.isEntry && !c.isDynamicEntry).map((c) => c.fileName);
  while (stack.length) {
    const name = stack.pop()!;
    if (initial.has(name)) continue;
    initial.add(name);
    const chunk = byName.get(name);
    if (!chunk) continue;
    for (const css of chunk.importedCss) initial.add(css);
    for (const imp of chunk.imports) stack.push(imp);
  }
  return initial;
}
