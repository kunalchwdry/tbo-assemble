import { issueBookingAccessHandler, revokeBookingAccessHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Issue a booking link (event owner) (disabled until OWNER_SCOPE_API=1). */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return issueBookingAccessHandler(ownerScopeDeps)(request, (await params).bookingId);
}

/** Revoke all links and sessions of a booking (event owner) (disabled until OWNER_SCOPE_API=1). */
export async function DELETE(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return revokeBookingAccessHandler(ownerScopeDeps)(request, (await params).bookingId);
}
