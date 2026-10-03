/**
 * Installing candidate packages.
 *
 * **Hard rule 2 (safety): install scripts are never executed.** Candidate packages come from the
 * public registry and are treated as untrusted code: `--ignore-scripts` is not a flag the caller
 * can pass, it is baked in, and there is no code path in this package that omits it.
 *
 * The NODE_ENV handling is a measurement-validity rule, not a style choice (see CLAUDE.md):
 * a Vite build earlier in the same process leaves `NODE_ENV=production` set, which makes npm skip
 * devDependencies — so hosts would lose their build toolchain. We ask for dev deps explicitly and
 * neutralise the variable for the child process.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Flags every install in DepLens uses. `--ignore-scripts` first, because it is the safety one. */
export const INSTALL_ARGS = [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--prefer-offline',
  '--install-links',
  '--include=dev',
  '--loglevel=error',
] as const;

export interface InstallResult {
  installMs: number;
  /** Versions actually on disk after the install, for the packages that were requested. */
  resolved: Record<string, string>;
  npmLog: string;
}

export class InstallError extends Error {
  constructor(
    message: string,
    public readonly npmLog: string,
  ) {
    super(message);
    this.name = 'InstallError';
  }
}

/**
 * Merges `deps` into the package.json in `dir` and installs, without running any lifecycle script.
 * Returns the versions that actually landed, which is what reproducibility metadata records
 * (doc 07 §10) — a requested range like `^4.1.0` is never what we report.
 */
export async function installDeps(dir: string, deps: Record<string, string>): Promise<InstallResult> {
  const pkgPath = join(dir, 'package.json');
  type PkgJson = { name?: string; private?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const pkg: PkgJson = existsSync(pkgPath)
    ? (JSON.parse(await readFile(pkgPath, 'utf8')) as PkgJson)
    : { name: 'deplens-iso', private: true };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), ...deps };
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

  const t0 = performance.now();
  let npmLog = '';
  if (Object.keys(pkg.dependencies).length > 0 || Object.keys(pkg.devDependencies ?? {}).length > 0) {
    const { stdout, stderr } = await execFileP('npm', [...INSTALL_ARGS], {
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: 'development' },
    });
    npmLog = `${stdout}${stderr}`.trim();
    if (process.env.DEPLENS_NPM_LOG) console.error(`[npm ${dir}] ${npmLog}`);
    // npm can exit 0 after rolling an install back, leaving an empty tree. Catching it here gives a
    // clear error instead of a confusing "cannot find package" from the bundler two steps later.
    if (!existsSync(join(dir, 'node_modules'))) {
      throw new InstallError(`npm install produced no node_modules in ${dir}`, npmLog);
    }
  }
  const installMs = performance.now() - t0;

  const resolved: Record<string, string> = {};
  for (const name of Object.keys(deps)) {
    try {
      const pj = JSON.parse(await readFile(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as {
        version?: string;
      };
      if (pj.version) resolved[name] = pj.version;
    } catch {
      // Sub-path or aliased dependency — left out rather than guessed.
    }
  }
  return { installMs, resolved, npmLog };
}

/** Reads an installed package's manifest, or null when it is not present. */
export async function readInstalledManifest(dir: string, name: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}
