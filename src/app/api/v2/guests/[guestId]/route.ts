import { deleteGuestHandler, patchGuestHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Update allowlisted guest fields (owner/editor) (disabled until OWNER_SCOPE_API=1). */
export async function PATCH(request: Request, { params }: { params: Promise<{ guestId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return patchGuestHandler(ownerScopeDeps)(request, (await params).guestId);
}

/** Delete a guest without active bookings (owner/editor) (disabled until OWNER_SCOPE_API=1). */
export async function DELETE(request: Request, { params }: { params: Promise<{ guestId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return deleteGuestHandler(ownerScopeDeps)(request, (await params).guestId);
}
