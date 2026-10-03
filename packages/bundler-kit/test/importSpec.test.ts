import { describe, expect, it } from 'vitest';
import { baselineBlock, bindingsOf, packageNamesOf, parseImports, treatmentBlock } from '../src/importSpec.ts';
import { injectInto, MARKER_END, MARKER_START } from '../src/inject.ts';

describe('import specs', () => {
  it('parses default, namespace, named and aliased imports', () => {
    const p = parseImports(`import React, { useState as uS, useEffect } from 'react'; import * as d3 from "d3-scale"`);
    expect(p).toHaveLength(2);
    expect(p[0]!.defaultBinding).toBe('React');
    expect(p[0]!.named).toEqual([
      { imported: 'useState', local: 'uS' },
      { imported: 'useEffect', local: 'useEffect' },
    ]);
    expect(p[1]!.namespaceBinding).toBe('d3');
    expect(bindingsOf(p)).toEqual(['React', 'uS', 'useEffect', 'd3']);
  });

  it('handles side-effect-only imports and type-only named imports', () => {
    const p = parseImports(`import 'normalize.css'; import { type Foo, bar } from 'x'`);
    expect(p[0]!.sideEffectOnly).toBe(true);
    expect(p[1]!.named.map((n) => n.local)).toEqual(['bar']);
  });

  it('derives package names from bare specifiers', () => {
    expect(packageNamesOf({ code: `import debounce from 'lodash/debounce'; import { z } from '@scope/pkg/sub'` })).toEqual([
      'lodash',
      '@scope/pkg',
    ]);
  });

  it('builds treatment and baseline blocks with a sink', () => {
    expect(treatmentBlock({ code: `import { format } from 'date-fns'` })).toBe(
      `import { format } from 'date-fns'\nglobalThis.__DL_SINK__ = [format];`,
    );
    expect(baselineBlock()).toBe('globalThis.__DL_SINK__ = [];');
    expect(treatmentBlock({ code: `import dayjs from 'dayjs'`, placement: 'lazy' })).toBe(
      `globalThis.__DL_SINK__ = [() => import("dayjs")];`,
    );
  });

  it('injects between markers and keeps the rest of the entry intact', () => {
    const src = `// head\n${MARKER_START}\nglobalThis.__DL_SINK__ = [];\n${MARKER_END}\nrender();\n`;
    const out = injectInto(src, { code: `import x from 'x'` });
    expect(out).toContain(`import x from 'x'\nglobalThis.__DL_SINK__ = [x];`);
    expect(out.startsWith('// head\n')).toBe(true);
    expect(out.endsWith(`${MARKER_END}\nrender();\n`)).toBe(true);
    expect(injectInto(src, null)).toBe(src);
  });

  it('rejects hosts without markers', () => {
    expect(() => injectInto('render()', null)).toThrow(/missing/);
  });
});
