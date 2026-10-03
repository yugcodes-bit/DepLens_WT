'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Captcha } from '@/components/Captcha.tsx';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { loginSchema } from '@/lib/validation.ts';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '', captcha: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(params.get('reset') === '1' ? 'Password changed. Sign in with your new password.' : null);
  const [busy, setBusy] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    const checked = clientValidate(loginSchema, form);
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }

    setBusy(true);
    const res = await postJson('/api/auth/login', form);
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not sign in' });
      setCaptchaKey((k) => k + 1);
      setForm((f) => ({ ...f, captcha: '' }));
      return;
    }

    // Correct password but an unverified address: the server has already sent a fresh code.
    if (res.next === 'verify') {
      router.push(`/verify?email=${encodeURIComponent(form.email)}${res.devCode ? `&code=${res.devCode}` : ''}`);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sign in</h1>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} success={notice ?? undefined} />

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
        <Field
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="current-password"
        />
        <Captcha value={form.captcha} onChange={set('captcha')} error={errors.captcha} refreshKey={captchaKey} disabled={busy} />

        <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-1 text-sm text-[var(--color-ink-soft)]">
        <p>
          <Link href="/forgot" className="font-medium text-[var(--color-brand)] underline">
            Forgot your password?
          </Link>
        </p>
        <p>
          No account yet?{' '}
          <Link href="/register" className="font-medium text-[var(--color-brand)] underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during static prerendering.
  return (
    <Suspense fallback={<p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
