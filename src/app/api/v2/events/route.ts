import { listEventsHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Owner-scoped event list (disabled until OWNER_SCOPE_API=1; see docs/security/owner-scoped-migration.md). */
export async function GET(request: Request) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return listEventsHandler(ownerScopeDeps)(request);
}
