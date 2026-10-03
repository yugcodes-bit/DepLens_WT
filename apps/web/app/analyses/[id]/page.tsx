import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';
import { AnalysisView } from './AnalysisView.tsx';

export const metadata = {
  title: 'Analysis · DepLens',
  description: 'What these packages will cost your app at runtime.',
};

/**
 * One analysis.
 *
 * The page itself only checks that someone is signed in; whether *this* analysis belongs to them is
 * decided by the API route the client polls (FR-68), so ownership is enforced on every request
 * rather than once at render time.
 */
export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;

  return <AnalysisView id={id} />;
}
