import pool from '../db';

/**
 * Who is allowed to use the bot.
 *
 * SECURITY FIX: before, every incoming WhatsApp message — from anyone — was
 * processed against the one hard-coded organisation. Now the sender's number
 * must be registered, and the sender's organisation is looked up from it. This
 * is also what makes the app genuinely multi-tenant.
 */
export interface Member {
  organizationId: string;
  phone: string;
  name: string | null;
  role: 'owner' | 'staff';
}

export async function findMemberByPhone(phone: string): Promise<Member | null> {
  const res = await pool.query(
    `SELECT organization_id, phone, name, role FROM organization_members WHERE phone = $1 AND is_active = TRUE
     UNION ALL
     SELECT id, owner_phone, owner_name, 'owner' FROM organizations WHERE owner_phone = $1
     LIMIT 1`,
    [phone]
  );
  if (!res.rows.length) return null;
  const r = res.rows[0];
  return { organizationId: r.organization_id, phone: r.phone, name: r.name, role: r.role };
}

export async function addMember(orgId: string, phone: string, name: string | null, role: 'owner' | 'staff') {
  await pool.query(
    `INSERT INTO organization_members (phone, organization_id, name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (phone) DO UPDATE SET organization_id = EXCLUDED.organization_id, name = EXCLUDED.name,
       role = EXCLUDED.role, is_active = TRUE`,
    [phone, orgId, name, role]
  );
}
