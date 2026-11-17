import 'server-only';
import prisma from '@/lib/db';
import { supabaseServer } from '@/lib/supabase/server';
import { createRateLimiter, clientKey } from '@/lib/rate-limit';
import { ownerScopeEnabled, type OwnerScopeDeps } from './owner-scope-handlers';
import { ownerRepo } from './owner-repo';
import { capabilityStore } from './booking-capability';

/**
 * Real dependencies of the owner-scoped API. Identity comes from Supabase `getUser()`, which verifies the session with
 * the Auth server (never a user id from the request). Data comes from Prisma, which connects with elevated credentials
 * and bypasses RLS, so every query in owner-repo.ts carries the ownership condition itself.
 *
 * REQUIRES the approved schema migration (docs/security/migrations/2026-11-17-event-ownership.up.sql). The routes load
 * this module only when OWNER_SCOPE_API=1. Limits are per server instance (not a shared quota).
 */
const capabilityLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const publicLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export const ownerScopeDeps: OwnerScopeDeps = {
  enabled: ownerScopeEnabled,
  async principal() {
    const client = await supabaseServer();
    const { data, error } = await client.auth.getUser();
    return error || !data.user ? { kind: 'anonymous' } : { kind: 'user', authUserId: data.user.id };
  },
  repo: ownerRepo(prisma),
  capabilities: capabilityStore(prisma),
  now: () => new Date(),
  limit(request, bucket) {
    const d = (bucket === 'capability' ? capabilityLimiter : publicLimiter).check(`${bucket}:${clientKey(request.headers)}`);
    return { allowed: d.allowed, retryAfterSeconds: d.retryAfterSeconds };
  },
  legacyBookingLinks: () => process.env.LEGACY_BOOKING_LINKS !== '0',
};
