import { getEventHandler, patchEventHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Event detail for members (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return getEventHandler(ownerScopeDeps)(request, (await params).eventId);
}

/** Update allowlisted event fields (owner/editor) (disabled until OWNER_SCOPE_API=1). */
export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return patchEventHandler(ownerScopeDeps)(request, (await params).eventId);
}
