import { publicEventHandler, ownerScopeDisabled, ownerScopeEnabled } from '@/lib/access/owner-scope-handlers';

export const dynamic = 'force-dynamic';

/** Public fields of an active or published event (disabled until OWNER_SCOPE_API=1). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!ownerScopeEnabled()) return ownerScopeDisabled();
  const { ownerScopeDeps } = await import('@/lib/access/owner-scope-deps');
  return publicEventHandler(ownerScopeDeps)(request, (await params).slug);
}
