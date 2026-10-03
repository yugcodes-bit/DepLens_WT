'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { resetPasswordSchema } from '@/lib/validation.ts';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold tracking-tight">Reset link missing</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          This page needs the link from your email.{' '}
          <Link href="/forgot" className="font-medium text-[var(--color-brand)] underline">
            Request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = clientValidate(resetPasswordSchema, { ...form, token });
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    const res = await postJson('/api/auth/reset', { ...form, token });
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not change the password' });
      return;
    }
    router.push('/login?reset=1');
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Choose a new password</h1>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} />
        <Field
          label="New password"
          name="password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          hint="At least 10 characters."
        />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={errors.confirmPassword}
          autoComplete="new-password"
        />
        <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
        <p className="text-xs text-[var(--color-ink-faint)]">
          This signs out every device that is currently using this account.
        </p>
      </form>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>}>
      <ResetForm />
    </Suspense>
  );
}
