'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, FormMessage } from '@/components/Field.tsx';
import { clientValidate, postJson } from '@/lib/client.ts';
import { projectSchema } from '@/lib/validation.ts';

const EXAMPLE = JSON.stringify(
  {
    name: 'my-dashboard',
    private: true,
    dependencies: {
      react: '^19.1.0',
      'react-dom': '^19.1.0',
      'react-router-dom': '^7.0.0',
      zustand: '^5.0.0',
    },
  },
  null,
  2,
);

export function NewProjectForm({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', packageJson: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = clientValidate(projectSchema, form);
    if (checked.errors) {
      setErrors(checked.errors);
      return;
    }
    setBusy(true);
    const res = await postJson('/api/projects', form, csrfToken);
    setBusy(false);

    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not create the project' });
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">New project</h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-ink-soft)]">
        A project is your app&apos;s dependency context. Paste your <code>package.json</code> and every
        candidate you compare is measured against <em>this</em> app — which is the whole point, because a
        package your app already ships is nearly free.
      </p>

      <form onSubmit={submit} noValidate className="dl-card mt-6 flex flex-col gap-4 p-5 sm:p-6">
        <FormMessage error={errors._form} />

        <Field
          label="Project name"
          name="name"
          value={form.name}
          onChange={set('name')}
          error={errors.name}
          placeholder="Admin dashboard"
          maxLength={80}
        />

        <Field
          label="package.json"
          name="packageJson"
          value={form.packageJson}
          onChange={set('packageJson')}
          error={errors.packageJson}
          rows={14}
          placeholder={EXAMPLE}
          hint="Only the dependency list is kept. We store a hash of what you paste, never the file, and it expires in 24 hours."
        />

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="dl-btn dl-btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
          <button
            type="button"
            className="dl-btn dl-btn-ghost"
            onClick={() => set('packageJson')(EXAMPLE)}
            disabled={busy}
          >
            Use the example
          </button>
        </div>
      </form>
    </div>
  );
}
