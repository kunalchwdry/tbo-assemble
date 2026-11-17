import { getBookingHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Booking confirmation link, scoped to that booking (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return getBookingHandler(ownerScopeDeps)(request, (await params).bookingId);
}
