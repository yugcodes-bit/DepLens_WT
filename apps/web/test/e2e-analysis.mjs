/**
 * End-to-end test for the analysis flow (FR-04, FR-68, doc 06 §7.3).
 *
 *   1. terminal A:  pnpm db:serve
 *   2. terminal B:  DEPLENS_E2E=1 pnpm --filter @deplens/web dev -p 3111
 *   3. terminal C:  node apps/web/test/e2e-analysis.mjs
 *
 * It checks the parts that do not need a worker (auth, validation, ownership, queueing) and then,
 * if `--with-worker` is passed, runs the worker in-process and asserts on the finished result.
 * Without that flag it stops at "queued", so the suite stays fast and needs no npm installs.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const BASE = process.env.DEPLENS_E2E_BASE ?? 'http://localhost:3111';
const WITH_WORKER = process.argv.includes('--with-worker');
const repoRoot = resolve(import.meta.dirname, '../../..');

let passed = 0;
const failures = [];

function check(id, name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${id}  ${name}`);
  } else {
    failures.push(`${id}  ${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  × ${id}  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

/** Cookie jar across requests, so a session behaves like a browser's. */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

async function api(path, { method = 'GET', body, csrf, origin } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'x-deplens-csrf': csrf } : {}),
      ...(origin ? { origin } : { origin: BASE }),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  storeCookies(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/**
 * The captcha answer, which `/api/captcha` reveals only under `DEPLENS_E2E=1` in dev — a script
 * cannot read vector strokes. The flag is refused when NODE_ENV is production.
 */
async function captcha() {
  const res = await api('/api/captcha');
  if (!res.body.answer) {
    throw new Error('The captcha endpoint did not return an answer — start the server with DEPLENS_E2E=1 in dev mode');
  }
  return res.body.answer;
}

async function main() {
  const email = `analysis-${Date.now()}@example.test`;
  const password = 'Correct-Horse-9-Battery';

  group('TC-A1  A signed-out visitor cannot queue an analysis (FR-68)');
  {
    const res = await api('/api/analyses', {
      method: 'POST',
      body: { host: 'react', candidates: [{ pkg: 'dayjs', spec: { code: "import d from 'dayjs'" } }] },
    });
    check('TC-A1.1', 'POST /api/analyses returns 401 with no session', res.status === 401, `got ${res.status}`);
  }

  group('TC-A2  Register and verify an account');
  {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'Analysis Tester', email, password, confirmPassword: password, captcha: await captcha(), acceptTerms: true },
    });
    check('TC-A2.1', 'registration returns 201', reg.status === 201, `got ${reg.status} ${JSON.stringify(reg.body.errors ?? {})}`);
    const code = reg.body.devCode;
    check('TC-A2.2', 'a verification code was issued', typeof code === 'string' && code.length > 0);

    const ver = await api('/api/auth/verify', { method: 'POST', body: { email, code } });
    check('TC-A2.3', 'verification succeeds and signs the user in', ver.status === 200, `got ${ver.status}`);
  }

  const session = await api('/api/auth/session');
  const csrf = session.body.csrfToken;
  check('TC-A2.4', 'a CSRF token is available', typeof csrf === 'string' && csrf.length > 0);

  group('TC-A3  Validation is enforced on the server (FR-74 … FR-80)');
  {
    const noCandidates = await api('/api/analyses', { method: 'POST', csrf, body: { host: 'react', candidates: [] } });
    check('TC-A3.1', 'an empty candidate list is rejected', noCandidates.status === 400, `got ${noCandidates.status}`);

    const badHost = await api('/api/analyses', {
      method: 'POST',
      csrf,
      body: { host: '../../etc/passwd', candidates: [{ pkg: 'dayjs', spec: { code: "import d from 'dayjs'" } }] },
    });
    check('TC-A3.2', 'a host outside the allowlist is rejected', badHost.status === 400, `got ${badHost.status}`);

    const notAnImport = await api('/api/analyses', {
      method: 'POST',
      csrf,
      body: { host: 'react', candidates: [{ pkg: 'dayjs', spec: { code: 'fetch("http://evil")' } }] },
    });
    check('TC-A3.3', 'an import spec that is not an import is rejected', notAnImport.status === 400, `got ${notAnImport.status}`);

    const badPkg = await api('/api/analyses', {
      method: 'POST',
      csrf,
      body: { host: 'react', candidates: [{ pkg: 'NOT A PACKAGE!', spec: { code: "import d from 'dayjs'" } }] },
    });
    check('TC-A3.4', 'an invalid package name is rejected', badPkg.status === 400, `got ${badPkg.status}`);

    const tooMany = await api('/api/analyses', {
      method: 'POST',
      csrf,
      body: {
        host: 'react',
        candidates: Array.from({ length: 9 }, () => ({ pkg: 'dayjs', spec: { code: "import d from 'dayjs'" } })),
      },
    });
    check('TC-A3.5', 'more than 8 candidates is rejected', tooMany.status === 400, `got ${tooMany.status}`);
  }

  group('TC-A4  CSRF protection (FR-71)');
  {
    const noToken = await api('/api/analyses', {
      method: 'POST',
      body: { host: 'react', candidates: [{ pkg: 'dayjs', spec: { code: "import d from 'dayjs'" } }] },
    });
    check('TC-A4.1', 'a POST without the CSRF header is refused', noToken.status === 403, `got ${noToken.status}`);

    const foreign = await api('/api/analyses', {
      method: 'POST',
      csrf,
      origin: 'https://evil.example',
      body: { host: 'react', candidates: [{ pkg: 'dayjs', spec: { code: "import d from 'dayjs'" } }] },
    });
    check('TC-A4.2', 'a cross-origin POST is refused even with a valid token', foreign.status === 403, `got ${foreign.status}`);
  }

  group('TC-A5  Queueing an analysis');
  let jobId;
  {
    const res = await api('/api/analyses', {
      method: 'POST',
      csrf,
      body: {
        host: 'react',
        profile: 'mid-tier-mobile',
        budget: { scriptMs: 50 },
        candidates: [{ pkg: 'dayjs@1.11.13', spec: { code: "import dayjs from 'dayjs'", placement: 'initial' } }],
      },
    });
    check('TC-A5.1', 'a valid request is accepted with 202', res.status === 202, `got ${res.status} ${JSON.stringify(res.body.errors ?? {})}`);
    jobId = res.body.jobId;
    check('TC-A5.2', 'a job id is returned', typeof jobId === 'string' && jobId.length === 36);

    const job = await api(`/api/analyses/${jobId}`);
    check('TC-A5.3', 'the job can be read back', job.status === 200, `got ${job.status}`);
    // Not strictly 'queued': if a worker happens to be running it may have claimed the job
    // already, which is correct behaviour and must not fail the suite.
    check(
      'TC-A5.4',
      'it is queued, or already claimed by a running worker',
      job.body.status === 'queued' || job.body.status === 'running',
      `got ${job.body.status}`,
    );
    check('TC-A5.5', 'no result yet', job.body.result === null || job.body.result === undefined);
  }

  group('TC-A6  An analysis belongs to the user who queued it (FR-68)');
  {
    const mine = jobId;
    jar.clear();
    const other = `other-${Date.now()}@example.test`;
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: { name: 'Other Tester', email: other, password, confirmPassword: password, captcha: await captcha(), acceptTerms: true },
    });
    await api('/api/auth/verify', { method: 'POST', body: { email: other, code: reg.body.devCode } });

    const stolen = await api(`/api/analyses/${mine}`);
    check('TC-A6.1', "another user cannot read someone else's analysis", stolen.status === 404, `got ${stolen.status}`);
    check('TC-A6.2', 'the refusal does not reveal that the id exists', stolen.body.errors?._form === 'Analysis not found');

    const malformed = await api('/api/analyses/not-a-uuid');
    check('TC-A6.3', 'a malformed id is rejected', malformed.status === 400, `got ${malformed.status}`);
  }

  if (WITH_WORKER) {
    group('TC-A7  The worker produces a result (doc 06 §7.2)');

    // Sign back in as the owner first, so the job can be polled while the worker runs.
    jar.clear();
    const login = await api('/api/auth/login', { method: 'POST', body: { email, password, captcha: await captcha() } });
    check('TC-A7.0', 'the owner can sign back in', login.status === 200, `got ${login.status}`);

    // A watching worker, not a single-shot one: the queue is FIFO, so older jobs from a previous
    // run are claimed first and this test must wait for *its* job rather than for the next one.
    const worker = startWatchingWorker();
    let job;
    try {
      job = await waitForJob(jobId, 15 * 60 * 1000);
    } finally {
      await stopWorker(worker);
    }
    check('TC-A7.1', 'the job finished', job.body.status === 'done', `status ${job.body.status} error ${job.body.error ?? ''}`);
    const result = job.body.result;
    check('TC-A7.2', 'a result is attached', Boolean(result));
    if (result) {
      check('TC-A7.3', 'the host is reported', result.host?.name === 'react', `got ${result.host?.name}`);
      check('TC-A7.4', 'one candidate came back', result.reports?.length === 1, `got ${result.reports?.length}`);
      const r = result.reports?.[0];
      check('TC-A7.5', 'Δbytes is exact', r?.bytes?.min?.provenance === 'exact', `got ${r?.bytes?.min?.provenance}`);
      check('TC-A7.6', 'Δbytes is positive for a package the host does not ship', (r?.bytes?.min?.value ?? 0) > 0, `got ${r?.bytes?.min?.value}`);
      check('TC-A7.7', 'ΔScript is predicted, never measured', r?.script?.provenance === 'predicted', `got ${r?.script?.provenance}`);
      check('TC-A7.8', 'ΔScript carries an interval', Array.isArray(r?.script?.interval) && r.script.interval.length === 2);
      check('TC-A7.9', 'the model announces itself as the placeholder', r?.model?.trainedOnCells === null && /b3/.test(r?.model?.kind ?? ''));
      check('TC-A7.10', 'a verdict was reached', ['low', 'moderate', 'uncertain', 'high'].includes(r?.verdict?.risk), `got ${r?.verdict?.risk}`);
      check('TC-A7.11', 'features cover the static groups', (r?.featureGroups ?? []).join('+') === 'G1+G2+G3+G4+G5+G7', `got ${(r?.featureGroups ?? []).join('+')}`);
      check('TC-A7.12', 'no measured G6 feature leaked into a static analysis', !Object.keys(r?.features ?? {}).includes('iso_script_ms'));
      check('TC-A7.13', 'at least one reason was given', (r?.why ?? []).length > 0);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed, ${passed + failures.length} test cases`);
  if (failures.length) {
    console.log('\nFailed cases:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
}

/** Starts the tier-2 worker in watch mode, as a child process, exactly as a deployment would. */
function startWatchingWorker() {
  console.log('  (starting the tier-2 worker — it installs packages and builds twice per job, so this is slow)');
  return spawn('npx', ['tsx', 'services/analyzer/worker.ts', '--watch', '--max', '20'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres' },
    stdio: 'inherit',
  });
}

/**
 * Stops the worker child.
 *
 * On Windows the child was spawned through a shell, so `kill()` only reaps the `cmd` wrapper and
 * leaves `npx tsx` running — which keeps this process alive forever. `taskkill /T` takes the whole
 * tree.
 */
function stopWorker(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
    child.once('exit', () => resolvePromise());
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
    // Do not hang the suite if the child refuses to go.
    setTimeout(resolvePromise, 10_000);
  });
}

/** Polls one job until it leaves the queue, or gives up. */
async function waitForJob(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const res = await api(`/api/analyses/${id}`);
    const status = res.body.status;
    if (status !== last) {
      console.log(`    job ${id} -> ${status} ${res.body.progressMessage ?? ''}`);
      last = status;
    }
    if (status === 'done' || status === 'failed' || status === 'cancelled') return res;
    if (Date.now() > deadline) {
      console.log(`    gave up waiting after ${Math.round(timeoutMs / 1000)}s (last status: ${status})`);
      return res;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
