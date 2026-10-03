/**
 * Feature group G4 (doc 08 §3). Each case is a minimal snippet whose expected count is obvious by
 * reading it, so a regression points at the feature rather than at the fixture.
 */
import { describe, expect, it } from 'vitest';
import { extractAstFeatures, parseAdded } from '../src/ast.ts';
import { namesInGroup, validateVector } from '../src/schema.ts';

const f = extractAstFeatures;

describe('G4 extractor — contract', () => {
  it('emits exactly the G4 group and nothing else', () => {
    expect(Object.keys(f('const a = 1;')).sort()).toEqual([...namesInGroup('G4')].sort());
  });

  it('every emitted value satisfies its declared schema type', () => {
    expect(validateVector(f('export function x(){ return 1 } x();'))).toEqual([]);
  });

  it('empty added code gives an all-zero vector, which is the right answer for a shared package', () => {
    const v = f('');
    expect(v.ast_nodes).toBe(0);
    expect(v.fn_count).toBe(0);
    expect(v.toplevel_stmts).toBe(0);
    expect(v.fn_bytes_share_toplevel).toBe(0);
    expect(v.regenerator_runtime).toBe(false);
  });
});

describe('functions by kind', () => {
  it('counts declarations, expressions and arrows separately', () => {
    const v = f('function a(){}\nconst b = function(){};\nconst c = () => 1;');
    expect(v.fn_decl).toBe(1);
    expect(v.fn_expr).toBe(1);
    expect(v.fn_arrow).toBe(1);
  });

  it('counts async functions and generators', () => {
    const v = f('async function a(){}\nfunction* b(){}\nconst c = async () => 1;');
    expect(v.async_fns).toBe(2);
    expect(v.generators).toBe(1);
  });

  it('counts a generator method once', () => {
    expect(f('const o = { *gen(){} };').generators).toBe(1);
    expect(f('class A { *gen(){} }').generators).toBe(1);
  });
});

describe('eager-compile signals', () => {
  it('counts an IIFE', () => {
    expect(f('(function(){ return 1 })();').iife_count).toBe(1);
    expect(f('(() => 1)();').iife_count).toBe(1);
  });

  it('counts parenthesized function expressions, V8s eager-compile hint', () => {
    expect(f('const x = (function(){ return 1 });').pife_count).toBe(1);
    // An unparenthesized function expression is lazily compiled, so it must not count.
    expect(f('const x = function(){ return 1 };').pife_count).toBe(0);
  });
});

describe('module-scope work', () => {
  it('separates top-level calls from calls inside functions', () => {
    const v = f('init();\nfunction later(){ alsoCalled(); }');
    expect(v.toplevel_calls).toBe(1);
  });

  it('counts top-level new-expressions', () => {
    expect(f('const m = new Map();\nfunction f(){ return new Set() }').toplevel_new).toBe(1);
  });

  it('counts top-level loops and nesting depth', () => {
    const v = f('for (let i=0;i<3;i++){ for (let j=0;j<3;j++){ while(0){} } }');
    expect(v.toplevel_loops).toBe(1);
    expect(v.max_loop_depth).toBe(3);
  });

  it('scores a pure declaration as no side effect but a call as one', () => {
    expect(f('const a = 1;\nexport function b(){}').toplevel_side_effect_score).toBe(0);
    expect(f('const a = compute();').toplevel_side_effect_score).toBe(1);
    expect(f('sideEffect();').toplevel_side_effect_score).toBe(1);
  });

  it('sees work hidden inside a top-level literal', () => {
    expect(f('const t = [compute()];').toplevel_side_effect_score).toBe(1);
    expect(f('const t = [1, 2, 3];').toplevel_side_effect_score).toBe(0);
  });

  it('does not count an import as side-effecting', () => {
    expect(f("import x from 'y';\nconst a = 1;").toplevel_side_effect_score).toBe(0);
  });

  it('counts module-scope statements', () => {
    expect(f('const a = 1;\nconst b = 2;\nrun();').toplevel_stmts).toBe(3);
  });
});

describe('fn_bytes_share_toplevel', () => {
  it('is near 1 when almost everything runs at import', () => {
    expect(f('let x = 0; for (let i = 0; i < 10; i++) { x += i; }').fn_bytes_share_toplevel).toBeGreaterThan(0.9);
  });

  it('is near 0 when almost everything is inside a function that is never called', () => {
    const body = 'function big(){ let x = 0; ' + 'x += 1; '.repeat(200) + ' }';
    expect(f(body).fn_bytes_share_toplevel).toBeLessThan(0.1);
  });

  it('never exceeds 1, even with nested functions', () => {
    const v = f('function a(){ function b(){ function c(){} } }');
    expect(v.fn_bytes_share_toplevel).toBeGreaterThanOrEqual(0);
    expect(v.fn_bytes_share_toplevel).toBeLessThanOrEqual(1);
  });
});

describe('data and literals', () => {
  it('counts object literal properties', () => {
    expect(f('const o = { a: 1, b: 2, c: 3 };').obj_literal_props).toBe(3);
  });

  it('measures the largest literal', () => {
    const v = f('const small = {a:1}; const big = ' + JSON.stringify(Object.fromEntries([...Array(50)].map((_, i) => [`k${i}`, i]))) + ';');
    expect(v.largest_literal_bytes).toBeGreaterThan(200);
  });

  it('sums string literal bytes and counts templates', () => {
    const v = f('const a = "hello"; const b = `world ${a}`;');
    expect(v.string_literal_bytes).toBe(7); // the raw "hello" including both quotes
    expect(v.template_literals).toBe(1);
  });

  it('counts regex literals and RegExp constructor calls separately', () => {
    const v = f('const r = /ab+c/g; const s = new RegExp("x");');
    expect(v.regex_literals).toBe(1);
    expect(v.regex_ctor_calls).toBe(1);
  });

  it('counts JSON.parse payloads', () => {
    expect(f('const data = JSON.parse(\'{"a":1}\');').json_parse_calls).toBe(1);
  });
});

describe('risk signals', () => {
  it('counts eval and new Function', () => {
    expect(f('eval("1"); const g = new Function("return 1");').eval_like).toBe(2);
  });

  it('counts try/catch', () => {
    expect(f('try { risky() } catch (e) {}').try_catch).toBe(1);
  });

  it('counts dynamic imports', () => {
    expect(f('const p = import("./lazy.js");').dynamic_imports).toBe(1);
  });

  it('detects prototype patching as a polyfill signal', () => {
    expect(f('Array.prototype.flat = function(){};').polyfill_signals).toBe(1);
    expect(f('globalThis.fetch = impl;').polyfill_signals).toBe(1);
    // Writing to your own object is not a polyfill.
    expect(f('myObj.prototype.x = 1;').polyfill_signals).toBe(0);
  });

  it('detects a core-js import or require', () => {
    expect(f("import 'core-js/modules/es.array.flat.js';").polyfill_signals).toBe(1);
    expect(f("require('core-js/stable');").polyfill_signals).toBe(1);
  });

  it('detects regenerator-runtime', () => {
    expect(f('var x = regeneratorRuntime.mark(function(){});').regenerator_runtime).toBe(true);
    expect(f('var x = 1;').regenerator_runtime).toBe(false);
  });
});

describe('browser API references', () => {
  it('counts DOM references', () => {
    expect(f('document.querySelector("a").addEventListener("x", h);').dom_refs).toBeGreaterThanOrEqual(3);
  });

  it('counts forced-layout references', () => {
    expect(f('const r = el.getBoundingClientRect(); const w = el.offsetWidth;').layout_refs).toBe(2);
  });

  it('counts style injection signals', () => {
    expect(f('sheet.insertRule(".a{}", 0);').style_injection).toBe(1);
  });

  it('counts timers, rAF and idle callbacks separately', () => {
    const v = f('setTimeout(a,1); setInterval(b,1); requestAnimationFrame(c); requestIdleCallback(d);');
    expect(v.timer_refs).toBe(2);
    expect(v.raf_refs).toBe(1);
    expect(v.idle_refs).toBe(1);
  });

  it('counts observers', () => {
    expect(f('new MutationObserver(cb); new ResizeObserver(cb);').observer_refs).toBe(2);
  });

  it('counts Intl on the Intl object, not on each constructor', () => {
    expect(f('new Intl.DateTimeFormat("en"); new Intl.NumberFormat("en");').intl_refs).toBe(2);
  });

  it('counts WebAssembly and Worker references', () => {
    expect(f('WebAssembly.instantiateStreaming(x);').wasm_refs).toBeGreaterThanOrEqual(1);
    expect(f('new Worker("w.js");').worker_refs).toBe(1);
  });
});

describe('complexity', () => {
  it('sums decision points', () => {
    const v = f('if (a) {} else {} for (;;) {} while (0) {} const t = a ? 1 : 2; const u = a || b;');
    // if + for + while + conditional + logical = 5
    expect(v.cyclomatic_sum).toBe(5);
  });

  it('counts switch cases with a test', () => {
    const v = f('switch (x) { case 1: break; case 2: break; default: break; }');
    expect(v.cyclomatic_sum).toBe(2);
  });

  it('counts catch clauses', () => {
    expect(f('try {} catch (e) {}').cyclomatic_sum).toBe(1);
  });
});

describe('parsing', () => {
  it('parses ESM', () => {
    expect(parseAdded("import a from 'b'; export default a;").sourceType).toBe('module');
  });

  it('falls back to script for a classic bundle', () => {
    expect(parseAdded('with (obj) { x = 1; }').sourceType).toBe('script');
  });

  it('throws the module error for code that is neither', () => {
    expect(() => parseAdded('function ( {')).toThrow();
  });

  it('handles modern syntax without falling over', () => {
    const v = f('const x = a?.b ?? c; class A { #p = 1; static { init(); } }');
    expect(v.ast_nodes).toBeGreaterThan(0);
    expect(v.class_count).toBe(1);
  });

  it('counts class members', () => {
    expect(f('class A { a = 1; b(){} get c(){ return 1 } }').class_members).toBe(3);
  });
});

describe('the fixture distinction the project is built on', () => {
  /**
   * `bytes-K` and `eager-K` fixtures hold the *same* functions; `eager-K` additionally calls each
   * one at import. Size cannot tell them apart; G4 must (docs/research-log.md, doc 12 §1).
   */
  const fns = [...Array(20)].map((_, i) => `export function f${i}(a){ return a + ${i}; }`).join('\n');
  const all = `export const all = [${[...Array(20)].map((_, i) => `f${i}`).join(', ')}];`;

  it('separates never-called functions from functions called at import', () => {
    const lazy = f(`${fns}\n${all}`);
    const eager = f(`${fns}\n${all}\nexport const ran = all.map((g, i) => g(i));`);

    expect(eager.toplevel_calls).toBeGreaterThan(lazy.toplevel_calls);
    expect(eager.toplevel_side_effect_score).toBeGreaterThan(lazy.toplevel_side_effect_score);
    // Both ship the same functions, so the function counts match — the difference is the work.
    expect(eager.fn_decl).toBe(lazy.fn_decl);
  });
});
