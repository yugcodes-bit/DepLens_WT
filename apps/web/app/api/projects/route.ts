/**
 * Creates a project — the dependency context every analysis is measured against (FR-01, FR-68).
 *
 * We store a **hash** of the manifest plus the resolved dependency list, not the files themselves:
 * the dependency graph is all the analysis needs, and keeping less means there is less to leak and
 * less to delete (NFR-S2, NFR-S3).
 */
import type { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDb, projects } from '@deplens/db';
import { fail, ok, parseBody, route } from '@/lib/api.ts';
import { audit } from '@/lib/auth/guard.ts';
import { assertCsrf, requireUser } from '@/lib/auth/session.ts';
import { declaredDependencies, detectFramework } from '@/lib/framework.ts';
import { projectSchema } from '@/lib/validation.ts';

export const POST = route(async (request): Promise<NextResponse> => {
  const session = await requireUser();
  await assertCsrf(session);

  const { data, error } = await parseBody(request, projectSchema);
  if (error) return error;

  let manifest: unknown;
  try {
    manifest = JSON.parse(data.packageJson);
  } catch {
    return fail({ packageJson: 'This is not valid JSON' });
  }

  const deps = declaredDependencies(manifest);
  if (Object.keys(deps).length === 0) {
    return fail({
      packageJson: 'This package.json declares no dependencies, so there is no app context to compare against',
    });
  }

  const inserted = await getDb()
    .insert(projects)
    .values({
      userId: session.user.id,
      name: data.name,
      // Quick mode: the lockfile and manifest give the dependency graph, with no source upload (FR-01).
      mode: 'quick',
      framework: detectFramework(deps),
      manifestHash: createHash('sha256').update(data.packageJson).digest('hex').slice(0, 32),
      // NFR-S2: uploaded context expires automatically unless the user opts in to contribute.
      expiresAt: session.user.contributeMeasurements ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning({ id: projects.id, framework: projects.framework });

  const project = inserted[0]!;
  await audit('analysis.created', 'success', {
    userId: session.user.id,
    detail: { projectId: project.id, dependencies: Object.keys(deps).length },
  });

  return ok(
    {
      projectId: project.id,
      framework: project.framework,
      dependencyCount: Object.keys(deps).length,
      next: 'project',
    },
    201,
  );
});
