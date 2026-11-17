/**
 * Approved ownership mapping against a REAL, ISOLATED PostgreSQL database (synthetic records). Skipped without
 * TEST_DATABASE_URL; refuses anything that is not on localhost. Wipes the tables it uses.
 */
import { describe, test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { applyMapping, checkMapping, fingerprint, type Mapping } from '../src/lib/access/ownership-mapping';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_ && !/^postgresql:\/\/[^@/]+@(127\.0\.0\.1|localhost):\d+\/[\w-]+$/.test(URL_)) throw new Error('Refusing: TEST_DATABASE_URL must be a local isolated database.');
const skip = URL_ ? false : 'TEST_DATABASE_URL not set: isolated-database tests skipped';

const OWNER = '66666666-6666-4666-8666-666666666666', OTHER = '77777777-7777-4777-8777-777777777777', GHOST = '88888888-8888-4888-8888-888888888888';
const E1 = 'e1000000-0000-4000-8000-0000000000e1', E2 = 'e2000000-0000-4000-8000-0000000000e2', MISSING = 'e9000000-0000-4000-8000-0000000000e9';
let db: PrismaClient;
const mapping = (grants: Mapping['grants'], reference = 'APPROVAL-TEST-1'): Mapping => ({ approval: { approvedBy: 'Project owner (synthetic)', reference, date: '2026-11-17' }, grants });
const members = () => db.eventMember.count();

describe('ownership mapping on an isolated database', { skip }, () => {
  before(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_! }) });
    await db.$executeRawUnsafe('TRUNCATE "BookingAccess","EventMember","BookingAddOn","Booking","Guest","RoomBlock","AddOn","AttritionRule","Event","Agent" CASCADE');
    await db.$executeRawUnsafe(`DELETE FROM auth.users WHERE id IN ('${OWNER}','${OTHER}','${GHOST}')`);
    await db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ('${OWNER}'), ('${OTHER}')`);
    await db.agent.create({ data: { id: 'agent-m', name: 'Synthetic agent', email: 'agent-m@example.test', password: 'not-a-real-password' } });
    for (const [id, slug] of [[E1, 'map-e1'], [E2, 'map-e2']]) await db.event.create({ data: { id, slug, name: slug, type: 't', venue: 'v', location: 'l', checkIn: new Date('2027-01-01'), checkOut: new Date('2027-01-02'), agentId: 'agent-m' } });
  });
  after(async () => {
    await db?.$executeRawUnsafe(`DELETE FROM auth.users WHERE id IN ('${OWNER}','${OTHER}')`);
    await db?.$disconnect();
  });

  test('dry run writes nothing and reports counts and user-id prefixes only', async () => {
    const r = await checkMapping(db, mapping([{ eventId: E1, authUserId: OWNER, role: 'owner' }]));
    assert.equal(r.ok, true);
    assert.equal(r.authUsersChecked, true);
    assert.equal(r.grants[0].user, '66666666…');
    assert.equal(await members(), 0);
    assert.ok(!JSON.stringify(r).includes(OWNER));
  });

  test('refuses unknown events, unknown Supabase users, bad roles, duplicates and email approval references', async () => {
    const r = await checkMapping(db, mapping([
      { eventId: MISSING, authUserId: OWNER, role: 'owner' },
      { eventId: E1, authUserId: GHOST, role: 'owner' },
      { eventId: E2, authUserId: OWNER, role: 'admin' as 'owner' },
      { eventId: E1, authUserId: OTHER, role: 'viewer' },
      { eventId: E1, authUserId: OTHER, role: 'viewer' },
    ], 'someone@example.test'));
    assert.equal(r.ok, false);
    assert.deepEqual(r.grants.map(g => g.ok), [false, false, false, true, false]);
    assert.ok(r.problems.some(p => p.includes('no email')));
  });

  test('apply needs the dry-run fingerprint; a bad grant aborts the whole transaction', async () => {
    const good = mapping([{ eventId: E1, authUserId: OWNER, role: 'owner' }, { eventId: E2, authUserId: OWNER, role: 'owner' }]);
    assert.ok((await applyMapping(db, good, 'wrong')).refused);
    assert.equal(await members(), 0);
    // Passes the checks, then fails inside the transaction (event deleted after the check): nothing may remain.
    const racing = mapping([{ eventId: E1, authUserId: OTHER, role: 'viewer' }, { eventId: E2, authUserId: OTHER, role: 'viewer' }], 'APPROVAL-RACE');
    const fp = fingerprint(racing);
    const realCreate = db.$transaction.bind(db);
    let first = true;
    (db as unknown as { $transaction: unknown }).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => realCreate(async tx => {
      if (first) { first = false; await tx.event.delete({ where: { id: E2 } }); }
      return fn(tx);
    });
    await assert.rejects(applyMapping(db, racing, fp));
    (db as unknown as { $transaction: unknown }).$transaction = realCreate;
    assert.equal(await members(), 0, 'all or nothing');
    assert.equal(await db.event.count({ where: { id: E2 } }), 1, 'the deletion inside the failed transaction rolled back too');
    const applied = await applyMapping(db, good, fingerprint(good));
    assert.equal(applied.applied, 2);
    assert.deepEqual((await db.eventMember.findMany({ orderBy: { eventId: 'asc' }, select: { eventId: true, role: true, grantedBy: true } })).map(m => `${m.eventId}:${m.role}:${m.grantedBy}`), [`${E1}:owner:APPROVAL-TEST-1`, `${E2}:owner:APPROVAL-TEST-1`]);
  });

  test('a second owner is refused unless explicitly allowed; re-granting an existing member is refused', async () => {
    const second = mapping([{ eventId: E1, authUserId: OTHER, role: 'owner' }], 'APPROVAL-TEST-2');
    assert.equal((await checkMapping(db, second)).ok, false);
    assert.equal((await checkMapping(db, second, { allowAdditionalOwner: true })).ok, true);
    assert.equal((await checkMapping(db, mapping([{ eventId: E1, authUserId: OWNER, role: 'viewer' }], 'APPROVAL-TEST-3'))).ok, false);
  });
});
