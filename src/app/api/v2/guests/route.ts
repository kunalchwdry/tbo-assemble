import { createGuestHandler, listGuestsHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Guests of one event for its members (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return listGuestsHandler(ownerScopeDeps)(request);
}

/** Add a guest (owner/editor) (disabled until OWNER_SCOPE_API=1). */
export async function POST(request: Request) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return createGuestHandler(ownerScopeDeps)(request);
}
