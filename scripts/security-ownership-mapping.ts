/**
 * Approved event-ownership mapping (docs/security/event-ownership.md, "Assigning owners").
 *
 *   MAPPING_DATABASE_URL=… npx tsx scripts/security-ownership-mapping.ts mapping.json                # dry run (no writes)
 *   MAPPING_DATABASE_URL=… npx tsx scripts/security-ownership-mapping.ts mapping.json --apply --confirm <fingerprint>
 *
 * mapping.json: {"approval":{"approvedBy":"…","reference":"…","date":"YYYY-MM-DD"},"grants":[{"eventId":"…","authUserId":"…","role":"owner"}]}
 * Options: --report out.json (write the report), --allow-additional-owner, --skip-auth-check (only when auth.users is
 * not reachable and the user ids were verified another way). The database URL is read ONLY from MAPPING_DATABASE_URL
 * so the app's DATABASE_URL is never used by accident. Production use requires explicit approval.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { applyMapping, checkMapping, type Mapping } from '../src/lib/access/ownership-mapping';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--confirm' && args[args.indexOf(a) - 1] !== '--report');
  const flag = (n: string) => args.includes(n);
  const value = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const url = process.env.MAPPING_DATABASE_URL;
  if (!file || !url) { console.error('Usage: MAPPING_DATABASE_URL=… npx tsx scripts/security-ownership-mapping.ts mapping.json [--apply --confirm <fingerprint>]'); process.exit(2); }
  const mapping = JSON.parse(readFileSync(file, 'utf8')) as Mapping;
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const opts = { allowAdditionalOwner: flag('--allow-additional-owner'), skipAuthCheck: flag('--skip-auth-check') };
    const result = flag('--apply') ? await applyMapping(db, mapping, value('--confirm') ?? '', opts) : { applied: 0, report: await checkMapping(db, mapping, opts), refused: undefined as string | undefined };
    const { report } = result;
    console.log(`Mapping fingerprint: ${report.fingerprint}   reference: ${report.reference}   auth.users verified: ${report.authUsersChecked}`);
    for (const g of report.grants) console.log(`${g.ok ? 'OK     ' : 'PROBLEM'} event ${g.eventId} (${g.eventStatus ?? '?'}; ${g.guests ?? '?'} guests, ${g.bookings ?? '?'} bookings, ${g.activeMembers ?? '?'} members) -> user ${g.user} as ${g.role}${g.problems.length ? `: ${g.problems.join('; ')}` : ''}`);
    for (const p of report.problems) console.log(`PROBLEM ${p}`);
    if (value('--report')) writeFileSync(value('--report')!, JSON.stringify({ ...result, at: new Date().toISOString(), mode: flag('--apply') ? 'apply' : 'dry-run' }, null, 2));
    if (!flag('--apply')) { console.log(report.ok ? `Dry run only. To apply: --apply --confirm ${report.fingerprint}` : 'Dry run only. Fix the problems above first.'); process.exit(report.ok ? 0 : 1); }
    if (result.refused) { console.log(`REFUSED: ${result.refused}`); process.exit(1); }
    console.log(`Applied ${result.applied} grant(s) in one transaction.`);
  } finally {
    await db.$disconnect();
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
