#!/usr/bin/env node
/**
 * End-to-end test of the authentication and project-intake flows (doc 05 §9: page testing and
 * control-module testing; FR-60 … FR-80).
 *
 * It drives the running app over HTTP exactly as a browser would — real cookies, real CAPTCHA tokens,
 * real CSRF header — so it exercises the route handlers, the session store and the database together,
 * not mocks of them.
 *
 * Usage:
 *   # terminal 1
 *   cd apps/web && DEPLENS_E2E=1 npx next dev -p 3111
 *   # terminal 2
 *   node apps/web/test/e2e-auth.mjs http://127.0.0.1:3111
 *
 * `DEPLENS_E2E=1` makes `/api/captcha` return the challenge answer, because a script cannot read
 * vector strokes. It is refused whenever NODE_ENV is production, so a deployed instance never does it.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3111';

let passed = 0;
let failed = 0;
const results = [];

function record(id, name, expected, actual, ok) {
  results.push({ id, name, expected, actual, ok });
  if (ok) {
    passed++;
    console.log(`  ✓ ${id}  ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${id}  ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}

function check(id, name, expected, actual) {
  record(id, name, String(expected), String(actual), expected === actual);
}

function checkTruthy(id, name, expected, value) {
  record(id, name, expected, JSON.stringify(value), Boolean(value));
}

// ----------------------------------------------------------------- a tiny cookie jar
const jar = new Map();

function storeCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '' || /expires=thu, 01 jan 1970/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader(), ...headers },
    redirect: 'manual',
  });
  storeCookies(res);
  return res;
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, cookie: cookieHeader(), ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  storeCookies(res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* some responses are not JSON; the status is what matters then */
  }
  return { status: res.status, body: json ?? {} };
}

async function captcha() {
  const res = await get('/api/captcha');
  const body = await res.json();
  if (!body.answer) {
    throw new Error('The captcha endpoint did not return an answer — start the server with DEPLENS_E2E=1 in dev mode');
  }
  return body.answer;
}

// ----------------------------------------------------------------- the run
const stamp = Date.now();
const email = `e2e-${stamp}@deplens.test`;
const password = 'correct-horse-battery-7';

console.log(`\nDepLens auth e2e — ${BASE}\naccount: ${email}\n`);

console.log('TC-1  Public pages render');
for (const [id, path] of [
  ['TC-1.1', '/'],
  ['TC-1.2', '/login'],
  ['TC-1.3', '/register'],
  ['TC-1.4', '/how-it-works'],
  ['TC-1.5', '/forgot'],
]) {
  const res = await get(path);
  check(id, `GET ${path} returns 200`, 200, res.status);
}

console.log('\nTC-2  Protected routes refuse anonymous access (FR-67)');
{
  const res = await get('/dashboard');
  record('TC-2.1', 'GET /dashboard redirects an anonymous visitor', '307 or 308', String(res.status), [307, 308].includes(res.status));
  checkTruthy('TC-2.2', 'redirect target is /login', res.headers.get('location'), res.headers.get('location')?.includes('/login'));
  const api = await postJson('/api/projects', { name: 'x', packageJson: '{}' });
  check('TC-2.3', 'POST /api/projects without a session returns 401', 401, api.status);
}

console.log('\nTC-3  Registration validation (FR-74 … FR-80)');
{
  const answer = await captcha();
  const bad = await postJson('/api/auth/register', {
    name: '',
    email: 'not-an-email',
    password: 'short',
    confirmPassword: 'different',
    captcha: answer,
    acceptTerms: true,
  });
  check('TC-3.1', 'invalid payload returns 400', 400, bad.status);
  checkTruthy('TC-3.2', 'required-field error on name (FR-74)', bad.body.errors?.name, bad.body.errors?.name);
  checkTruthy('TC-3.3', 'email-format error (FR-75)', bad.body.errors?.email, bad.body.errors?.email);
  checkTruthy('TC-3.4', 'password-length error', bad.body.errors?.password, bad.body.errors?.password);

  const mismatch = await postJson('/api/auth/register', {
    name: 'E2E User',
    email,
    password,
    confirmPassword: `${password}x`,
    captcha: await captcha(),
    acceptTerms: true,
  });
  checkTruthy('TC-3.5', 'compare-validator error on confirmPassword (FR-76)', mismatch.body.errors?.confirmPassword, mismatch.body.errors?.confirmPassword);

  const noTerms = await postJson('/api/auth/register', {
    name: 'E2E User',
    email,
    password,
    confirmPassword: password,
    captcha: await captcha(),
    acceptTerms: false,
  });
  checkTruthy('TC-3.6', 'custom validator rejects unaccepted terms (FR-79)', noTerms.body.errors?.acceptTerms, noTerms.body.errors?.acceptTerms);
}

console.log('\nTC-4  CAPTCHA is enforced (FR-65)');
{
  await captcha(); // issues a valid cookie, so only the typed answer is wrong
  const res = await postJson('/api/auth/register', {
    name: 'E2E User',
    email,
    password,
    confirmPassword: password,
    captcha: 'WRONG',
    acceptTerms: true,
  });
  check('TC-4.1', 'a wrong captcha answer returns 400', 400, res.status);
  checkTruthy('TC-4.2', 'the error is reported on the captcha field', res.body.errors?.captcha, res.body.errors?.captcha);
}

console.log('\nTC-5  Register, then verify by OTP (FR-60, FR-61)');
let devCode = null;
{
  const res = await postJson('/api/auth/register', {
    name: 'E2E User',
    email,
    password,
    confirmPassword: password,
    captcha: await captcha(),
    acceptTerms: true,
  });
  check('TC-5.1', 'a valid registration returns 201', 201, res.status);
  checkTruthy('TC-5.2', 'a verification code was issued', res.body.devCode, res.body.devCode);
  devCode = res.body.devCode;

  const noSession = await get('/dashboard');
  record('TC-5.3', 'an unverified account cannot reach the dashboard (FR-61)', '307 or 308', String(noSession.status), [307, 308].includes(noSession.status));

  const wrong = await postJson('/api/auth/verify', { email, code: '000000' });
  check('TC-5.4', 'a wrong OTP is rejected', 400, wrong.status);

  const ok = await postJson('/api/auth/verify', { email, code: devCode });
  check('TC-5.5', 'the correct OTP verifies the account', 200, ok.status);
  check('TC-5.6', 'verification signs the user in', 'dashboard', ok.body.next);
  checkTruthy('TC-5.7', 'a session cookie was set (FR-62)', jar.has('deplens_session'), jar.has('deplens_session'));

  const replay = await postJson('/api/auth/verify', { email, code: devCode });
  record('TC-5.8', 'the same OTP cannot be used twice (FR-61)', 'rejected or already-verified', JSON.stringify(replay.body.next ?? replay.status), replay.body.next === 'login' || replay.status === 400);
}

console.log('\nTC-6  The session grants access (FR-62, FR-68)');
let csrfToken = null;
{
  const dash = await get('/dashboard');
  check('TC-6.1', 'GET /dashboard returns 200 when signed in', 200, dash.status);
  const html = await dash.text();
  checkTruthy('TC-6.2', 'the page shows the signed-in address', email, html.includes(email));

  const me = await get('/api/auth/session');
  const body = await me.json();
  check('TC-6.3', 'GET /api/auth/session reports the signed-in user', true, body.authenticated);
  csrfToken = body.csrfToken ?? null;
  checkTruthy('TC-6.4', 'a CSRF token is available to the form (FR-71)', csrfToken, csrfToken);
  check('TC-6.5', 'the session reports the default role', 'user', body.user?.role);
}

console.log('\nTC-7  CSRF protection (FR-71)');
{
  const noToken = await postJson('/api/projects', { name: 'No CSRF', packageJson: '{"dependencies":{"react":"^19.0.0"}}' });
  check('TC-7.1', 'a state-changing POST without the CSRF header returns 403', 403, noToken.status);

  const badOrigin = await postJson(
    '/api/projects',
    { name: 'Bad origin', packageJson: '{"dependencies":{"react":"^19.0.0"}}' },
    { 'x-deplens-csrf': csrfToken ?? 'x', origin: 'https://evil.example' },
  );
  check('TC-7.2', 'a cross-origin POST is refused even with a valid cookie', 403, badOrigin.status);
}

console.log('\nTC-8  Project intake (FR-01, FR-03)');
{
  const empty = await postJson(
    '/api/projects',
    { name: 'Empty', packageJson: '{"name":"x"}' },
    { 'x-deplens-csrf': csrfToken },
  );
  checkTruthy('TC-8.1', 'a package.json with no dependencies is rejected', empty.body.errors?.packageJson, empty.body.errors?.packageJson);

  const notJson = await postJson(
    '/api/projects',
    { name: 'Broken', packageJson: '{ not json' },
    { 'x-deplens-csrf': csrfToken },
  );
  check('TC-8.2', 'invalid JSON is rejected', 400, notJson.status);

  const created = await postJson(
    '/api/projects',
    {
      name: 'E2E dashboard',
      packageJson: JSON.stringify({
        name: 'dash',
        dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0', 'date-fns': '^4.1.0' },
      }),
    },
    { 'x-deplens-csrf': csrfToken },
  );
  check('TC-8.3', 'a valid project is created', 201, created.status);
  check('TC-8.4', 'the framework is detected from the dependencies (FR-03)', 'react', created.body.framework);
  check('TC-8.5', 'the dependency count is reported', 3, created.body.dependencyCount);

  const dash = await get('/dashboard');
  const html = await dash.text();
  checkTruthy('TC-8.6', 'the new project is listed on the dashboard', 'E2E dashboard', html.includes('E2E dashboard'));
}

console.log('\nTC-9  Logout (FR-64)');
{
  const res = await postJson('/api/auth/logout', {}, { 'x-deplens-csrf': csrfToken });
  check('TC-9.1', 'logout succeeds', 200, res.status);
  const after = await get('/dashboard');
  record('TC-9.2', 'the dashboard is no longer reachable', '307 or 308', String(after.status), [307, 308].includes(after.status));
}

console.log('\nTC-10  Login, including the lockout (FR-62, FR-66)');
{
  const wrongPw = await postJson('/api/auth/login', { email, password: 'definitely-wrong-1', captcha: await captcha() });
  check('TC-10.1', 'a wrong password returns 401', 401, wrongPw.status);
  record('TC-10.2', 'the message does not say which half was wrong', 'generic message', wrongPw.body.errors?._form ?? '', (wrongPw.body.errors?._form ?? '').includes('incorrect'));

  const unknown = await postJson('/api/auth/login', { email: `nobody-${stamp}@deplens.test`, password, captcha: await captcha() });
  record(
    'TC-10.3',
    'an unknown address gives the same answer as a wrong password (no account oracle)',
    wrongPw.body.errors?._form ?? '',
    unknown.body.errors?._form ?? '',
    unknown.body.errors?._form === wrongPw.body.errors?._form,
  );

  // Three more failures reach the 5-attempt account lock.
  let locked = false;
  for (let i = 0; i < 4; i++) {
    const res = await postJson('/api/auth/login', { email, password: 'definitely-wrong-1', captcha: await captcha() });
    if (res.status === 429) locked = true;
  }
  checkTruthy('TC-10.4', 'the account locks after repeated failures (FR-66)', locked, locked);

  const whileLocked = await postJson('/api/auth/login', { email, password, captcha: await captcha() });
  check('TC-10.5', 'even the correct password is refused while locked', 429, whileLocked.status);
}

console.log('\nTC-11  Password reset clears the lock and old sessions (FR-69)');
{
  const requested = await postJson('/api/auth/request-reset', { email, captcha: await captcha() });
  check('TC-11.1', 'a reset request succeeds', 200, requested.status);
  const token = requested.body.devToken;
  checkTruthy('TC-11.2', 'a reset token was issued', token, token);

  const tooShort = await postJson('/api/auth/reset', { token, password: 'short', confirmPassword: 'short' });
  check('TC-11.3', 'the new password must still pass validation', 400, tooShort.status);

  const newPassword = 'another-correct-horse-9';
  const done = await postJson('/api/auth/reset', { token, password: newPassword, confirmPassword: newPassword });
  check('TC-11.4', 'the reset completes', 200, done.status);

  const replay = await postJson('/api/auth/reset', { token, password: newPassword, confirmPassword: newPassword });
  check('TC-11.5', 'the reset token cannot be reused', 400, replay.status);

  const signedIn = await postJson('/api/auth/login', { email, password: newPassword, captcha: await captcha() });
  check('TC-11.6', 'the new password works and the lock is cleared', 200, signedIn.status);
  check('TC-11.7', 'the user lands on the dashboard', 'dashboard', signedIn.body.next);
}

// ----------------------------------------------------------------- summary
console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed, ${results.length} test cases`);
if (failed > 0) {
  console.log('\nFailed cases:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.id}  ${r.name}`);
}
console.log(`${'='.repeat(64)}\n`);
process.exit(failed > 0 ? 1 : 0);
