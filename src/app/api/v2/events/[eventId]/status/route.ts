import { eventStatusHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Change event status via the transition table (owner/editor) (disabled until OWNER_SCOPE_API=1). */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return eventStatusHandler(ownerScopeDeps)(request, (await params).eventId);
}
