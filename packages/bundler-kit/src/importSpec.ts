/**
 * Import specs (doc 01 §2, doc 07 §2.1).
 *
 * An import spec is the exact import statement(s) a developer intends to add.
 * The "sink" keeps the imported bindings alive so tree-shaking reflects real use
 * without executing any extra code:  globalThis.__DL_SINK__ = [a, b];
 */

export interface ImportSpec {
  /** One or more ES import declarations, e.g. `import { format } from 'date-fns'`. */
  code: string;
  /** JS expression assigned to the sink. Derived from the bindings when omitted. */
  sink?: string;
  /** `initial` (default): static import in the entry. `lazy`: dynamic import() that is never called during load. */
  placement?: 'initial' | 'lazy';
}

export const SINK = 'globalThis.__DL_SINK__';

export interface ParsedImport {
  source: string;
  defaultBinding?: string;
  namespaceBinding?: string;
  named: { imported: string; local: string }[];
  sideEffectOnly: boolean;
}

// The clause may not contain quotes or semicolons, so one declaration never swallows the next.
const IMPORT_RE = /import\s+(?:([^'";]*?)\s+from\s+)?(['"])([^'"]+)\2\s*;?/g;

/** Parses the subset of ES import syntax developers write in import specs. */
export function parseImports(code: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const clause = m[1]?.trim();
    const source = m[3]!;
    const parsed: ParsedImport = { source, named: [], sideEffectOnly: !clause };
    if (clause) {
      let rest = clause;
      // default binding (identifier before a comma or alone)
      const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(rest);
      if (def) {
        parsed.defaultBinding = def[1]!;
        rest = rest.slice(def[0].length).trim();
      }
      const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(rest);
      if (ns) parsed.namespaceBinding = ns[1]!;
      const named = /\{([\s\S]*?)\}/.exec(rest);
      if (named) {
        for (const part of named[1]!.split(',')) {
          const p = part.trim();
          if (!p || p.startsWith('type ')) continue;
          const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(p);
          if (asMatch) parsed.named.push({ imported: asMatch[1]!, local: asMatch[2]! });
          else parsed.named.push({ imported: p, local: p });
        }
      }
    }
    out.push(parsed);
  }
  if (out.length === 0) throw new Error(`No import declaration found in import spec: ${code}`);
  return out;
}

/** Local binding names introduced by the import spec (used for the default sink). */
export function bindingsOf(parsed: readonly ParsedImport[]): string[] {
  const names: string[] = [];
  for (const p of parsed) {
    if (p.defaultBinding) names.push(p.defaultBinding);
    if (p.namespaceBinding) names.push(p.namespaceBinding);
    for (const n of p.named) names.push(n.local);
  }
  return names;
}

/** The code block that replaces the injection marker in the treatment build. */
export function treatmentBlock(spec: ImportSpec): string {
  const parsed = parseImports(spec.code);
  if ((spec.placement ?? 'initial') === 'lazy') {
    // The import() is created but never called during load, so the package lands in a lazy chunk.
    const sources = [...new Set(parsed.map((p) => p.source))];
    const loaders = sources.map((s) => `() => import(${JSON.stringify(s)})`).join(', ');
    return `${SINK} = [${loaders}];`;
  }
  const sink = spec.sink ?? `[${bindingsOf(parsed).join(', ')}]`;
  return `${spec.code.trim()}\n${SINK} = ${sink};`;
}

/** The code block used in the baseline build: an empty sink, so the only difference is the import. */
export function baselineBlock(): string {
  return `${SINK} = [];`;
}

/** Package names referenced by the spec (bare specifiers → package name, handling scopes and sub-paths). */
export function packageNamesOf(spec: ImportSpec): string[] {
  const names = new Set<string>();
  for (const p of parseImports(spec.code)) {
    const src = p.source;
    if (src.startsWith('.') || src.startsWith('/')) continue;
    const parts = src.split('/');
    names.add(src.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!);
  }
  return [...names];
}
