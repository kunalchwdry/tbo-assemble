import { getEventHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Owner-scoped event detail (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return getEventHandler(ownerScopeDeps)(request, (await params).eventId);
}
