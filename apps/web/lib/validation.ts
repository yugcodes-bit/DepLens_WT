/**
 * Shared validation schemas (doc 05 §4.5c, FR-74 … FR-80).
 *
 * One definition per form, used **twice**: in the browser for immediate feedback, and again in the
 * route handler, which is the only side that is trusted (constraint C-1 — anything from a client can
 * be forged). Because both sides import these objects, a rule cannot drift between them.
 *
 * The six validator kinds the project guidelines ask for are all here:
 *   required (FR-74) · email (FR-75) · compare (FR-76) · range (FR-77) · number (FR-78) · custom (FR-79)
 */
import { z } from 'zod';

// ----------------------------------------------------------------- reusable field rules

/** FR-74 required: a trimmed value that is not empty. */
export const requiredText = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** FR-75 email: format checked, then lower-cased so accounts are case-insensitive. */
export const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address, for example you@example.com')
  .transform((v) => v.toLowerCase());

/**
 * Password rule. Length does far more for strength than symbol classes do, so the floor is 10
 * characters, with a cheap check against the handful of passwords everyone tries first.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'iloveyou',
  'letmein123',
  'admin12345',
  'welcome123',
]);

export const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'That password is too common — pick something less guessable')
  .refine((v) => new Set(v).size > 3, 'Password must use more than a few distinct characters');

/** FR-78 number: rejects non-numeric text, NaN and Infinity, including from HTML form strings. */
export const numberField = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .refine(Number.isFinite, `${label} must be a finite number`);

/** FR-77 range: a finite number inside an inclusive interval. */
export const rangeField = (label: string, min: number, max: number) =>
  numberField(label)
    .refine((v) => v >= min && v <= max, `${label} must be between ${min} and ${max}`);

/** FR-79 custom: npm package names, per the registry's own rules. */
export const packageNameField = requiredText('Package name', 214).refine(
  (v) => /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(v),
  'Not a valid npm package name (lower case, optionally @scope/name)',
);

/**
 * FR-79 custom: the import spec must be at least one real ES import declaration.
 *
 * This is the validator that matters most for research validity: an import spec that does not parse
 * produces a build whose byte delta is zero, which would enter the dataset as "this package is free"
 * (FR-34). Catching it at the form is far cheaper than catching it after a build.
 */
const IMPORT_DECL = /import\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1\s*;?/g;

export const importSpecField = requiredText('Import statement', 500)
  .refine((v) => [...v.matchAll(IMPORT_DECL)].length > 0, "Write a real import, e.g. import { format } from 'date-fns'")
  .refine(
    (v) => [...v.matchAll(IMPORT_DECL)].every((m) => !m[2]!.startsWith('.') && !m[2]!.startsWith('/')),
    'Import from a package name, not a relative path',
  )
  .refine((v) => !/\brequire\s*\(/.test(v), 'Use ES import syntax, not require()');

// ----------------------------------------------------------------- forms

/** FR-76 compare: password and confirmation must match, reported on the confirm field. */
export const registerSchema = z
  .object({
    name: requiredText('Name', 80),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string({ required_error: 'Confirm your password' }),
    captcha: requiredText('Captcha answer', 16),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue' }) }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailField,
  password: requiredText('Password', 200),
  captcha: requiredText('Captcha answer', 16),
});

export const otpSchema = z.object({
  email: emailField,
  code: requiredText('Code', 6).refine((v) => /^\d{6}$/.test(v), 'The code is 6 digits'),
});

export const requestResetSchema = z.object({ email: emailField, captcha: requiredText('Captcha answer', 16) });

export const resetPasswordSchema = z
  .object({
    token: requiredText('Reset token', 200),
    password: passwordField,
    confirmPassword: z.string({ required_error: 'Confirm your password' }),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

/** A candidate dependency the user wants analysed. */
export const candidateSchema = z.object({
  name: packageNameField,
  version: z.string().trim().max(64).optional(),
  importSpec: importSpecField,
  placement: z.enum(['initial', 'lazy']).default('initial'),
});

export const analysisSchema = z.object({
  projectId: z.string().uuid('Pick a project'),
  profile: z.enum(['desktop', 'mid-tier-mobile', 'low-end-mobile']).default('mid-tier-mobile'),
  // FR-77: the ranges come from doc 05 — a budget outside them is a typo, not an intention.
  budgetScriptMs: rangeField('Script budget', 1, 10_000).optional(),
  budgetBrotliKb: rangeField('Byte budget', 1, 10_000).optional(),
  candidates: z.array(candidateSchema).min(1, 'Add at least one candidate').max(5, 'Compare at most 5 candidates'),
});

export const projectSchema = z.object({
  name: requiredText('Project name', 80),
  packageJson: requiredText('package.json', 400_000).refine((v) => {
    try {
      const parsed = JSON.parse(v) as unknown;
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  }, 'This is not valid JSON — paste the contents of your package.json'),
  lockfile: z.string().trim().max(8_000_000).optional(),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type AnalysisInput = z.input<typeof analysisSchema>;

/**
 * Turns a Zod failure into `{ field: message }`, which is what every form in this app renders and
 * what every route handler returns, so client and server report errors identically.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    out[key] ??= issue.message;
  }
  return out;
}
