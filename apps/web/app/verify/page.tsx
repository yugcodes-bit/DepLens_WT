'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { otpSchema } from '@/lib/validation.ts';

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    const checked = clientValidate(otpSchema, { email, code });
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }

    setBusy(true);
    const res = await postJson('/api/auth/verify', { email, code });
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not verify that code' });
      return;
    }
    if (res.next === 'login') {
      router.push('/login');
      return;
    }
    // Verification signs the user in, so go straight to the dashboard.
    router.push('/dashboard');
    router.refresh();
  }

  async function resend() {
    setErrors({});
    setBusy(true);
    const res = await postJson('/api/auth/resend-code', { email });
    setBusy(false);
    setNotice(res.message ?? 'If that address needs verifying, a new code is on its way.');
    if (res.devCode) setDevCode(res.devCode);
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Verify your email</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Enter the 6-digit code we sent you. It expires in 10 minutes and works once.
      </p>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} success={notice ?? undefined} />

        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            setErrors((e) => ({ ...e, email: '' }));
          }}
          error={errors.email}
          autoComplete="email"
        />
        <Field
          label="6-digit code"
          name="code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(v) => {
            setCode(v.replace(/\D/g, ''));
            setErrors((e) => ({ ...e, code: '' }));
          }}
          error={errors.code}
          autoComplete="one-time-code"
          placeholder="123456"
        />

        <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Verify and sign in'}
        </button>
        <button type="button" onClick={resend} className="dl-btn dl-btn-ghost text-sm" disabled={busy || !email}>
          Send me a new code
        </button>

        {devCode && (
          <p className="rounded-lg border border-dashed border-[var(--color-warn)] p-3 text-sm">
            Development mode — your new code is{' '}
            <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-base font-bold">{devCode}</code>
          </p>
        )}
      </form>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>}>
      <VerifyForm />
    </Suspense>
  );
}
