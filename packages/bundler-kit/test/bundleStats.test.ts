import { describe, expect, it } from 'vitest';
import { deplensStats, initialFiles, type BundleStats } from '../src/bundleStats.ts';
import { packageOfPath } from '../src/metafile.ts';

/**
 * A bundle shaped like a real Vite build: one entry chunk that statically imports a vendor chunk
 * and pulls in CSS, plus a lazy chunk reached only through import(). Only the first group is part
 * of the initial load — which is the whole point of the `lazy` placement (FR-14).
 */
const BUNDLE: BundleStats = {
  chunks: [
    {
      fileName: 'assets/index-aaa.js',
      isEntry: true,
      isDynamicEntry: false,
      imports: ['assets/vendor-bbb.js'],
      dynamicImports: ['assets/lazy-ccc.js'],
      importedCss: ['assets/index-aaa.css'],
      codeBytes: 1000,
      modules: [{ id: 'D:/work/src/main.jsx', renderedLength: 400, originalLength: 600 }],
    },
    {
      fileName: 'assets/vendor-bbb.js',
      isEntry: false,
      isDynamicEntry: false,
      imports: [],
      dynamicImports: [],
      importedCss: [],
      codeBytes: 5000,
      modules: [
        { id: 'D:/work/node_modules/react/index.js', renderedLength: 300, originalLength: 400 },
        { id: 'D:/work/node_modules/react-dom/client.js', renderedLength: 4000, originalLength: 5000 },
      ],
    },
    {
      fileName: 'assets/lazy-ccc.js',
      isEntry: false,
      isDynamicEntry: true,
      imports: [],
      dynamicImports: [],
      importedCss: [],
      codeBytes: 9000,
      modules: [{ id: 'D:/work/node_modules/lodash/lodash.js', renderedLength: 9000, originalLength: 70000 }],
    },
  ],
  assets: [{ fileName: 'index.html', bytes: 400 }],
};

describe('bundle stats', () => {
  it('initial load = entry + static imports + their CSS, never dynamic chunks', () => {
    const initial = initialFiles(BUNDLE);
    expect([...initial].sort()).toEqual(['assets/index-aaa.css', 'assets/index-aaa.js', 'assets/vendor-bbb.js']);
    expect(initial.has('assets/lazy-ccc.js')).toBe(false);
  });

  it('a chunk reachable both statically and dynamically still counts as initial', () => {
    const shared: BundleStats = {
      ...BUNDLE,
      chunks: BUNDLE.chunks.map((c) =>
        c.fileName === 'assets/index-aaa.js' ? { ...c, imports: [...c.imports, 'assets/lazy-ccc.js'] } : c,
      ),
    };
    expect(initialFiles(shared).has('assets/lazy-ccc.js')).toBe(true);
  });

  it('survives a dangling chunk reference without looping forever', () => {
    const broken: BundleStats = {
      chunks: [{ ...BUNDLE.chunks[0]!, imports: ['assets/missing.js', 'assets/index-aaa.js'] }],
      assets: [],
    };
    expect(initialFiles(broken).has('assets/index-aaa.js')).toBe(true);
  });

  it('maps module ids to package names, including scopes and Windows separators', () => {
    expect(packageOfPath('D:/work/node_modules/react/index.js')).toBe('react');
    expect(packageOfPath('D:\\work\\node_modules\\react\\index.js')).toBe('react');
    expect(packageOfPath('/w/node_modules/@scope/pkg/dist/i.js')).toBe('@scope/pkg');
    // Nested installs resolve to the innermost package, which is the copy that actually shipped.
    expect(packageOfPath('/w/node_modules/a/node_modules/b/i.js')).toBe('b');
    expect(packageOfPath('/w/src/main.js')).toBeNull();
  });

  it('the plugin reports chunks, assets and per-module rendered length', () => {
    let captured: BundleStats | null = null;
    const plugin = deplensStats((s) => (captured = s));
    plugin.generateBundle({}, {
      'assets/index-aaa.js': {
        type: 'chunk',
        fileName: 'assets/index-aaa.js',
        code: 'console.log(1)',
        isEntry: true,
        imports: [],
        dynamicImports: [],
        modules: { 'D:\\work\\src\\main.js': { renderedLength: 14, originalLength: 20 } },
        viteMetadata: { importedCss: new Set(['assets/index-aaa.css']) },
      },
      'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' },
    });
    const stats = captured as unknown as BundleStats;
    expect(stats.chunks).toHaveLength(1);
    expect(stats.chunks[0]!.codeBytes).toBe('console.log(1)'.length);
    expect(stats.chunks[0]!.importedCss).toEqual(['assets/index-aaa.css']);
    // Module ids are normalised to forward slashes so package mapping works on Windows.
    expect(stats.chunks[0]!.modules[0]!.id).toBe('D:/work/src/main.js');
    expect(stats.assets).toEqual([{ fileName: 'index.html', bytes: 13 }]);
  });
});
