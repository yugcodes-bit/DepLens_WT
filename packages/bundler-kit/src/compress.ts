/**
 * Exact byte sizes with **fixed** compression settings.
 *
 * The settings are part of the measurement protocol (doc 07 §2.4): gzip level 9 and brotli
 * quality 11. Every byte number DepLens reports — Δbytes in the product, `iso_*`/`ctx_*` features
 * in the dataset, and the web app's own budget check — goes through these two functions, so a
 * number is never accidentally compared against one produced at a different compression level.
 */
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';

export const GZIP_LEVEL = 9;
export const BROTLI_QUALITY = 11;

export interface ByteSizes {
  minBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export function sizesOf(buf: Buffer | Uint8Array | string): ByteSizes {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : Buffer.from(buf);
  return {
    minBytes: b.length,
    gzipBytes: gzipSync(b, { level: GZIP_LEVEL }).length,
    brotliBytes: brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }).length,
  };
}

export const addSizes = (a: ByteSizes, b: ByteSizes): ByteSizes => ({
  minBytes: a.minBytes + b.minBytes,
  gzipBytes: a.gzipBytes + b.gzipBytes,
  brotliBytes: a.brotliBytes + b.brotliBytes,
});

export const subSizes = (a: ByteSizes, b: ByteSizes): ByteSizes => ({
  minBytes: a.minBytes - b.minBytes,
  gzipBytes: a.gzipBytes - b.gzipBytes,
  brotliBytes: a.brotliBytes - b.brotliBytes,
});

export const ZERO_SIZES: ByteSizes = { minBytes: 0, gzipBytes: 0, brotliBytes: 0 };
