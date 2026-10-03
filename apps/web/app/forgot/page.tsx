'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Captcha } from '@/components/Captcha.tsx';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { requestResetSchema } from '@/lib/validation.ts';

export default function ForgotPage() {
  const [form, setForm] = useState({ email: '', captcha: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = clientValidate(requestResetSchema, form);
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    const res = await postJson('/api/auth/request-reset', form);
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not send a reset link' });
      setCaptchaKey((k) => k + 1);
      setForm((f) => ({ ...f, captcha: '' }));
      return;
    }
    setSent(res.message ?? 'If that address has an account, a reset link is on its way.');
    if (res.devToken) setDevToken(res.devToken);
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reset your password</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        We will email a single-use link, valid for 30 minutes. Using it signs you out everywhere.
      </p>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} success={sent ?? undefined} />

        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          autoComplete="email"
        />
        <Captcha value={form.captcha} onChange={set('captcha')} error={errors.captcha} refreshKey={captchaKey} disabled={busy} />

        <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>

        {devToken && (
          <p className="rounded-lg border border-dashed border-[var(--color-warn)] p-3 text-sm break-all">
            Development mode — open{' '}
            <Link href={`/reset?token=${encodeURIComponent(devToken)}`} className="font-medium text-[var(--color-brand)] underline">
              /reset?token={devToken.slice(0, 12)}…
            </Link>
          </p>
        )}
      </form>

      <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
        <Link href="/login" className="font-medium text-[var(--color-brand)] underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
