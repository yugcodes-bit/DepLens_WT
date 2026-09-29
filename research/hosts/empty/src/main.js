// Empty host: used for ISOLATED builds/measurements (C_iso, doc 01 §2). Only the injection block runs.

/* @deplens-inject */
globalThis.__DL_SINK__ = [];
/* @deplens-end */

requestAnimationFrame(() => performance.mark('app-ready'));
