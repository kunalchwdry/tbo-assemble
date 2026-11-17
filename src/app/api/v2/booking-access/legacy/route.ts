import { legacyBookingLinkHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Compatibility bridge for pre-capability booking URLs (disabled until OWNER_SCOPE_API=1). */
export async function POST(request: Request) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return legacyBookingLinkHandler(ownerScopeDeps)(request);
}
