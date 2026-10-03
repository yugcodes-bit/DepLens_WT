/**
 * Feature group G4 — the code structure of the **added** code (doc 08 §3).
 *
 * Why these features and not a byte count: V8 does not pay for code it never runs. A function that
 * is exported but never called at load is only pre-parsed; a parenthesized function expression is
 * eagerly compiled; and anything at module scope executes the moment the module is imported. So
 * the features split the added code three ways — how much of it runs at import (`toplevel_*`,
 * `fn_bytes_share_toplevel`), how much V8 is likely to compile eagerly (`iife_count`,
 * `pife_count`), and what kind of work it does when it runs (the `*_refs` counts).
 *
 * The input is the **unminified** isolated bundle from `@deplens/bundler-kit`, because minification
 * destroys exactly the distinction `fn_bytes_share_toplevel` measures.
 */
import { parse, type Options } from 'acorn';
import { namesInGroup, type FeatureVector } from './schema.ts';

/** Any ESTree node. Walked structurally, so syntax acorn adds later still traverses. */
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const PARSE_OPTIONS: Options = { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true };

/**
 * Parses as an ES module, falling back to `script` for a bundle that turned out to be a classic
 * script (a UMD package bundled with no ESM entry). Reported rather than silently swallowed.
 */
export function parseAdded(code: string): { program: Node; sourceType: 'module' | 'script' } {
  try {
    return { program: parse(code, PARSE_OPTIONS) as unknown as Node, sourceType: 'module' };
  } catch (moduleError) {
    try {
      return { program: parse(code, { ...PARSE_OPTIONS, sourceType: 'script' }) as unknown as Node, sourceType: 'script' };
    } catch {
      throw moduleError;
    }
  }
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

/** Decision points for cyclomatic complexity. */
const DECISION_TYPES = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ConditionalExpression',
  'CatchClause',
]);

/** Member-expression property names (and bare identifiers) counted per feature. */
const REF_SETS = {
  dom_refs: new Set([
    'document',
    'querySelector',
    'querySelectorAll',
    'createElement',
    'createElementNS',
    'createTextNode',
    'appendChild',
    'insertBefore',
    'removeChild',
    'addEventListener',
    'removeEventListener',
    'setAttribute',
    'getAttribute',
    'innerHTML',
    'textContent',
    'classList',
  ]),
  layout_refs: new Set([
    'getBoundingClientRect',
    'getComputedStyle',
    'offsetWidth',
    'offsetHeight',
    'offsetTop',
    'offsetLeft',
    'offsetParent',
    'clientWidth',
    'clientHeight',
    'clientTop',
    'clientLeft',
    'scrollWidth',
    'scrollHeight',
    'scrollTop',
    'scrollLeft',
    'getClientRects',
  ]),
  style_injection: new Set(['insertRule', 'addRule', 'styleSheet', 'styleSheets', 'cssText', 'adoptedStyleSheets', 'CSSStyleSheet']),
  timer_refs: new Set(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval']),
  raf_refs: new Set(['requestAnimationFrame', 'cancelAnimationFrame']),
  idle_refs: new Set(['requestIdleCallback', 'cancelIdleCallback']),
  observer_refs: new Set(['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']),
  wasm_refs: new Set(['WebAssembly', 'instantiateStreaming', 'compileStreaming']),
  worker_refs: new Set(['Worker', 'SharedWorker', 'ServiceWorker', 'postMessage']),
} as const;

/** Built-ins whose prototype being written to is a polyfill signal. */
const POLYFILL_TARGETS = new Set([
  'Array',
  'Object',
  'String',
  'Number',
  'Function',
  'Boolean',
  'Date',
  'RegExp',
  'Error',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Symbol',
  'Math',
  'JSON',
  'Reflect',
  'Proxy',
]);

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

export interface AstFeatures extends FeatureVector {
  ast_nodes: number;
  fn_count: number;
  fn_decl: number;
  fn_expr: number;
  fn_arrow: number;
  toplevel_stmts: number;
  toplevel_calls: number;
  toplevel_new: number;
  iife_count: number;
  pife_count: number;
  class_count: number;
  class_members: number;
  toplevel_loops: number;
  max_loop_depth: number;
  cyclomatic_sum: number;
  obj_literal_props: number;
  template_literals: number;
  regex_literals: number;
  regex_ctor_calls: number;
  json_parse_calls: number;
  eval_like: number;
  try_catch: number;
  async_fns: number;
  generators: number;
  polyfill_signals: number;
  dom_refs: number;
  layout_refs: number;
  style_injection: number;
  timer_refs: number;
  raf_refs: number;
  idle_refs: number;
  observer_refs: number;
  intl_refs: number;
  wasm_refs: number;
  worker_refs: number;
  dynamic_imports: number;
  toplevel_side_effect_score: number;
  fn_bytes_share_toplevel: number;
  largest_literal_bytes: number;
  string_literal_bytes: number;
  regenerator_runtime: boolean;
}

/** Statement types at module scope that are pure declarations — they define, they do not run work. */
const PURE_TOPLEVEL = new Set([
  'ImportDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'ExportAllDeclaration',
  'EmptyStatement',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
]);

/** Expression types whose evaluation cannot do observable work. */
const PURE_INIT = new Set([
  'Literal',
  'Identifier',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'TemplateLiteral',
  'ThisExpression',
]);

/**
 * Is this module-scope statement side-effecting? A `const x = 1` is not; a `const x = init()` is,
 * because the call runs at import. Object and array literals are treated as pure *containers* but
 * their elements are inspected, so `const t = [compute()]` still counts.
 */
function isSideEffectingToplevel(stmt: Node): boolean {
  if (PURE_TOPLEVEL.has(stmt.type)) return false;

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const inner = stmt['declaration'] as Node | null | undefined;
    return inner ? isSideEffectingToplevel(inner) : false;
  }
  if (stmt.type === 'VariableDeclaration') {
    const decls = (stmt['declarations'] as Node[] | undefined) ?? [];
    return decls.some((d) => containsWork(d['init'] as Node | null | undefined));
  }
  // Expression statements, loops, if/try/switch at module scope: all run at import.
  return true;
}

/** Does evaluating this expression run code? */
function containsWork(expr: Node | null | undefined): boolean {
  if (!expr) return false;
  if (PURE_INIT.has(expr.type)) return false;
  if (expr.type === 'ObjectExpression' || expr.type === 'ArrayExpression') {
    let found = false;
    walk(expr, (n) => {
      if (n !== expr && (n.type === 'CallExpression' || n.type === 'NewExpression' || n.type === 'TaggedTemplateExpression')) found = true;
    });
    return found;
  }
  return true;
}

/** Depth-first walk over every child node, by structure rather than by a node-type table. */
function walk(node: Node, visit: (n: Node, parent: Node | null) => void, parent: Node | null = null): void {
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && typeof (child as Node).type === 'string') walk(child as Node, visit, node);
      }
    } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') {
      walk(value as Node, visit, node);
    }
  }
}

/** True when the first non-whitespace character before `start` is an opening parenthesis. */
function isParenthesized(code: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const ch = code[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return ch === '(';
  }
  return false;
}

/**
 * Extracts every G4 feature from a block of added code.
 *
 * `code` must be the unminified added bundle. The function never throws on odd input beyond a
 * parse failure: an empty string yields an all-zero vector, which is the correct answer for a
 * candidate that adds nothing (the host already shipped it).
 */
export function extractAstFeatures(code: string): AstFeatures {
  const f: AstFeatures = {
    ast_nodes: 0,
    fn_count: 0,
    fn_decl: 0,
    fn_expr: 0,
    fn_arrow: 0,
    toplevel_stmts: 0,
    toplevel_calls: 0,
    toplevel_new: 0,
    iife_count: 0,
    pife_count: 0,
    class_count: 0,
    class_members: 0,
    toplevel_loops: 0,
    max_loop_depth: 0,
    cyclomatic_sum: 0,
    obj_literal_props: 0,
    template_literals: 0,
    regex_literals: 0,
    regex_ctor_calls: 0,
    json_parse_calls: 0,
    eval_like: 0,
    try_catch: 0,
    async_fns: 0,
    generators: 0,
    polyfill_signals: 0,
    dom_refs: 0,
    layout_refs: 0,
    style_injection: 0,
    timer_refs: 0,
    raf_refs: 0,
    idle_refs: 0,
    observer_refs: 0,
    intl_refs: 0,
    wasm_refs: 0,
    worker_refs: 0,
    dynamic_imports: 0,
    toplevel_side_effect_score: 0,
    fn_bytes_share_toplevel: 0,
    largest_literal_bytes: 0,
    string_literal_bytes: 0,
    regenerator_runtime: false,
  };

  if (code.trim() === '') return f;

  const { program } = parseAdded(code);
  const body = (program['body'] as Node[] | undefined) ?? [];

  // --- module-scope statements -------------------------------------------------------------
  f.toplevel_stmts = body.length;
  f.toplevel_side_effect_score = body.filter(isSideEffectingToplevel).length;

  // --- byte share outside any function -----------------------------------------------------
  // Only *outermost* functions are summed: a nested function's bytes are already inside its
  // parent's range, so adding both would double-count and could exceed the program length.
  let functionBytes = 0;
  const outermostFunctions: Node[] = [];
  (function collect(node: Node, insideFn: boolean) {
    const isFn = FUNCTION_TYPES.has(node.type);
    if (isFn && !insideFn) outermostFunctions.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      const value = node[key];
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
          collect(child as Node, insideFn || isFn);
        }
      }
    }
  })(program, false);
  for (const fn of outermostFunctions) functionBytes += fn.end - fn.start;
  const total = program.end - program.start;
  f.fn_bytes_share_toplevel = total > 0 ? Math.max(0, (total - functionBytes) / total) : 0;

  // --- the single structural pass -----------------------------------------------------------
  /** How many function bodies enclose the node currently being visited. */
  const fnDepthOf = new Map<Node, number>();
  const loopDepthOf = new Map<Node, number>();
  fnDepthOf.set(program, 0);
  loopDepthOf.set(program, 0);

  walk(program, (n, parent) => {
    f.ast_nodes++;

    const parentFnDepth = parent ? (fnDepthOf.get(parent) ?? 0) : 0;
    const parentLoopDepth = parent ? (loopDepthOf.get(parent) ?? 0) : 0;
    const isFn = FUNCTION_TYPES.has(n.type);
    const isLoop = LOOP_TYPES.has(n.type);
    fnDepthOf.set(n, parentFnDepth + (isFn ? 1 : 0));
    loopDepthOf.set(n, parentLoopDepth + (isLoop ? 1 : 0));
    const atToplevel = parentFnDepth === 0;

    if (isLoop) {
      f.max_loop_depth = Math.max(f.max_loop_depth, parentLoopDepth + 1);
      // Only the *outermost* loop counts: a nested loop is work done by the loop that encloses it,
      // and its nesting is already described by `max_loop_depth`.
      if (atToplevel && parentLoopDepth === 0) f.toplevel_loops++;
    }

    if (DECISION_TYPES.has(n.type)) f.cyclomatic_sum++;
    if (n.type === 'SwitchCase' && n['test'] !== null && n['test'] !== undefined) f.cyclomatic_sum++;
    if (n.type === 'LogicalExpression') f.cyclomatic_sum++;

    switch (n.type) {
      case 'FunctionDeclaration':
        f.fn_decl++;
        break;
      case 'FunctionExpression':
        f.fn_expr++;
        if (isParenthesized(code, n.start)) f.pife_count++;
        break;
      case 'ArrowFunctionExpression':
        f.fn_arrow++;
        if (isParenthesized(code, n.start)) f.pife_count++;
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        f.class_count++;
        break;
      case 'ClassBody':
        f.class_members += ((n['body'] as Node[] | undefined) ?? []).length;
        break;
      case 'TryStatement':
        f.try_catch++;
        break;
      case 'TemplateLiteral':
        f.template_literals++;
        break;
      case 'ObjectExpression':
        f.obj_literal_props += ((n['properties'] as Node[] | undefined) ?? []).length;
        break;
      case 'ImportExpression':
        f.dynamic_imports++;
        break;
      case 'NewExpression': {
        if (atToplevel) f.toplevel_new++;
        const callee = n['callee'] as Node | undefined;
        const calleeName = callee?.type === 'Identifier' ? (callee['name'] as string) : undefined;
        if (calleeName === 'RegExp') f.regex_ctor_calls++;
        if (calleeName === 'Function') f.eval_like++;
        break;
      }
      case 'CallExpression': {
        if (atToplevel) f.toplevel_calls++;
        const callee = n['callee'] as Node | undefined;
        if (callee && FUNCTION_TYPES.has(callee.type)) f.iife_count++;
        if (callee?.type === 'Identifier') {
          const name = callee['name'] as string;
          if (name === 'eval') f.eval_like++;
          if (name === 'require') {
            // A bundled `require` of core-js is the clearest polyfill signal there is.
            const arg = ((n['arguments'] as Node[] | undefined) ?? [])[0];
            if (arg?.type === 'Literal' && typeof arg['value'] === 'string' && (arg['value'] as string).includes('core-js')) {
              f.polyfill_signals++;
            }
          }
        }
        if (callee?.type === 'MemberExpression') {
          const obj = callee['object'] as Node | undefined;
          const prop = callee['property'] as Node | undefined;
          const objName = obj?.type === 'Identifier' ? (obj['name'] as string) : undefined;
          const propName = prop?.type === 'Identifier' ? (prop['name'] as string) : undefined;
          if (objName === 'JSON' && propName === 'parse') f.json_parse_calls++;
        }
        break;
      }
      case 'Literal': {
        const value = n['value'];
        const raw = (n['raw'] as string | undefined) ?? '';
        if (n['regex']) f.regex_literals++;
        else if (typeof value === 'string') f.string_literal_bytes += Buffer.byteLength(raw, 'utf8');
        break;
      }
      case 'AssignmentExpression': {
        const left = n['left'] as Node | undefined;
        if (left?.type === 'MemberExpression' && isPolyfillTarget(left)) f.polyfill_signals++;
        break;
      }
      case 'ImportDeclaration': {
        const src = n['source'] as Node | undefined;
        if (src?.type === 'Literal' && typeof src['value'] === 'string' && (src['value'] as string).includes('core-js')) {
          f.polyfill_signals++;
        }
        break;
      }
    }

    if (n.type === 'ObjectExpression' || n.type === 'ArrayExpression') {
      f.largest_literal_bytes = Math.max(f.largest_literal_bytes, n.end - n.start);
    }

    if (isFn) {
      if (n['async'] === true) f.async_fns++;
      if (n['generator'] === true) f.generators++;
    }

    // --- reference counting -----------------------------------------------------------------
    // `el.getBoundingClientRect()` must count once, not twice. The MemberExpression is where the
    // reference is counted, so the property Identifier underneath it is skipped — otherwise every
    // member reference would be double-counted and only bare globals would be counted correctly.
    const isMemberProperty = parent?.type === 'MemberExpression' && parent['property'] === n;
    const refName =
      n.type === 'Identifier'
        ? isMemberProperty
          ? undefined
          : (n['name'] as string)
        : n.type === 'MemberExpression' && (n['property'] as Node | undefined)?.type === 'Identifier'
          ? ((n['property'] as Node)['name'] as string)
          : undefined;
    if (refName) {
      for (const [feature, set] of Object.entries(REF_SETS)) {
        if (set.has(refName)) (f[feature] as number)++;
      }
    }
    // `Intl.DateTimeFormat` etc. — counted on the Intl object, not on each constructor name.
    if (n.type === 'MemberExpression') {
      const obj = n['object'] as Node | undefined;
      if (obj?.type === 'Identifier' && obj['name'] === 'Intl') f.intl_refs++;
    }
  });

  f.generators += countGeneratorMethods(program);
  f.regenerator_runtime = /regeneratorRuntime|regenerator-runtime/.test(code);

  return f;
}

/** Object/class methods written as `*gen() {}` — the generator flag sits on the method, not the function. */
function countGeneratorMethods(program: Node): number {
  let n = 0;
  walk(program, (node) => {
    if ((node.type === 'Property' || node.type === 'MethodDefinition') && node['kind'] !== 'get' && node['kind'] !== 'set') {
      const value = node['value'] as Node | undefined;
      // The FunctionExpression itself already carried the flag and was counted; only count here
      // when the method node holds it and the value does not (older ESTree shapes).
      if (node['generator'] === true && value && value['generator'] !== true) n++;
    }
  });
  return n;
}

/** `Array.prototype.x = …`, `globalThis.fetch = …`, `window.Promise = …` */
function isPolyfillTarget(member: Node): boolean {
  const parts: string[] = [];
  let cur: Node | undefined = member;
  while (cur && cur.type === 'MemberExpression') {
    const prop = cur['property'] as Node | undefined;
    if (prop?.type === 'Identifier') parts.unshift(prop['name'] as string);
    cur = cur['object'] as Node | undefined;
  }
  const rootName = cur?.type === 'Identifier' ? (cur['name'] as string) : undefined;
  if (!rootName) return false;
  if (POLYFILL_TARGETS.has(rootName) && parts.includes('prototype')) return true;
  if (GLOBAL_OBJECTS.has(rootName) && parts.length === 1) return true;
  return false;
}

/** Guard: the extractor must emit exactly the G4 group, nothing more and nothing less. */
export function astFeatureNames(): string[] {
  return namesInGroup('G4');
}
