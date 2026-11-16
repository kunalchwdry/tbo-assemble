import { listGuestsHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Owner-scoped guest list for one event: GET /api/v2/guests?eventId=… (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return listGuestsHandler(ownerScopeDeps)(request);
}
