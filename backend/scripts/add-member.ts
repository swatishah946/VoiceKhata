/**
 * Register a WhatsApp number that is allowed to use the bot.
 *
 * Usage:
 *   npm run add-member -- +919876543210 "Papa" owner
 *   npm run add-member -- +919812345678 "Munshi" staff
 *
 * Messages from numbers that are not registered are ignored.
 */
import { config } from '../src/config';
import pool from '../src/db';
import { normalizePhone } from '../src/lib/phone';
import { addMember } from '../src/services/members.service';

async function main() {
  const [rawPhone, name = null, role = 'owner'] = process.argv.slice(2);
  const phone = normalizePhone(rawPhone);
  if (!phone || (role !== 'owner' && role !== 'staff')) {
    console.error('Usage: npm run add-member -- <phone e.g. +919876543210> [name] [owner|staff]');
    process.exit(1);
  }
  const orgId = process.env.ORG_ID || config.DEFAULT_ORG_ID;
  await addMember(orgId, phone, name, role);
  console.log(`✅ ${phone} (${name ?? 'no name'}) can now use the bot as ${role} of org ${orgId}`);
  await pool.end();
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
