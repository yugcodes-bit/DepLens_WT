import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';
import { NewProjectForm } from './NewProjectForm.tsx';

export const metadata = { title: 'New project — DepLens' };

export default async function NewProjectPage() {
  // Authorization before rendering (FR-67): a client-side redirect would briefly show the page.
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.user.emailVerifiedAt) redirect(`/verify?email=${encodeURIComponent(session.user.email)}`);

  return <NewProjectForm csrfToken={session.csrfToken} />;
}
