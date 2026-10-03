'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from '@/lib/client.ts';

/** Sign out (FR-64). A POST, not a link, so it cannot be triggered by a crafted image or prefetch. */
export function LogoutButton({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="dl-btn dl-btn-ghost text-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await postJson('/api/auth/logout', {}, csrfToken);
        router.replace('/');
        router.refresh();
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
