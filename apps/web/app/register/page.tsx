'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Captcha } from '@/components/Captcha.tsx';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { registerSchema } from '@/lib/validation.ts';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', captcha: '' });
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear a field's error as soon as the user edits it: keeping it visible is just nagging.
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setDevCode(null);

    // Client-side pass first, for instant feedback. The server runs the same schema again (C-1).
    const checked = clientValidate(registerSchema, { ...form, acceptTerms: accepted });
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }

    setBusy(true);
    const res = await postJson('/api/auth/register', { ...form, acceptTerms: accepted });
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not create the account' });
      // A rejected captcha token is spent — always hand out a fresh image.
      if (res.errors?.captcha) {
        setCaptchaKey((k) => k + 1);
        setForm((f) => ({ ...f, captcha: '' }));
      }
      return;
    }

    if (res.devCode) {
      setDevCode(res.devCode);
      return;
    }
    router.push(`/verify?email=${encodeURIComponent(form.email)}`);
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Create your account</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        An account stores your projects and lets you queue a real browser measurement. Measurement runs
        cost machine time, so they are limited per account.
      </p>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} />

        <Field label="Name" name="name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" maxLength={80} />
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          autoComplete="email"
          hint="We send a 6-digit code here to confirm it is yours."
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          hint="At least 10 characters. Length matters more than symbols."
        />
        <Field
          label="Confirm password"
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />

        <Captcha
          value={form.captcha}
          onChange={set('captcha')}
          error={errors.captcha}
          refreshKey={captchaKey}
          disabled={busy}
        />

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="acceptTerms"
              checked={accepted}
              onChange={(e) => {
                setAccepted(e.target.checked);
                setErrors((x) => ({ ...x, acceptTerms: '' }));
              }}
              aria-invalid={errors.acceptTerms ? true : undefined}
              className="mt-0.5 h-5 w-5"
            />
            <span>
              I understand this is a research project, and that measurements I choose to contribute may be
              published as part of an open dataset without my personal details.
            </span>
          </label>
          {errors.acceptTerms && (
            <p role="alert" className="text-xs font-medium text-[var(--color-bad)]">
              {errors.acceptTerms}
            </p>
          )}
        </div>

        <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>

        {devCode && (
          <div className="rounded-lg border border-dashed border-[var(--color-warn)] p-3 text-sm">
            <p className="font-semibold text-[var(--color-warn)]">Development mode — no email was sent</p>
            <p className="mt-1">
              Your verification code is{' '}
              <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-base font-bold">{devCode}</code>
            </p>
            <Link
              href={`/verify?email=${encodeURIComponent(form.email)}`}
              className="mt-2 inline-block font-medium text-[var(--color-brand)] underline"
            >
              Continue to verification →
            </Link>
          </div>
        )}
      </form>

      <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[var(--color-brand)] underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
