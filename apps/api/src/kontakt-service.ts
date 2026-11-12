/**
 * Contacts of the firms on site (Vorarbeiter, Monteure) – callable from the app. The NU maintains his own
 * contacts (portal, on sign-up), Bau-/Projektleitung can add them too. RLS: own staff see all, a NU only his firm.
 */
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { HttpError } from './mangel-service';

const KontaktInput = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  name: z.string().trim().min(2, 'Bitte den Namen angeben').max(120),
  funktion: z.string().trim().max(80).nullish(),
  telefon: z.string().trim().max(40).regex(/^[+0-9 ()/-]*$/, 'Bitte nur Ziffern, Leerzeichen und + / - ( )').nullish(),
  email: z.string().trim().email('Bitte eine gültige E-Mail').max(160).nullish().or(z.literal('')),
});

/** All contacts visible to the user, optionally only of the firms in one project. */
export async function listKontakte(tx: TxSql, projectId?: string) {
  return tx`
    SELECT k.id, k.company_id, c.name AS company, k.name, k.funktion, k.telefon, k.email
    FROM company_kontakt k JOIN company c ON c.id = k.company_id
    WHERE k.aktiv ${projectId ? tx`AND (k.company_id IN (SELECT company_id FROM project_company WHERE project_id = ${projectId})
                                      OR k.company_id IN (SELECT company_id FROM project_member WHERE project_id = ${projectId}))` : tx``}
    ORDER BY c.name, k.name`;
}

export async function saveKontakt(tx: TxSql, userId: string, input: unknown) {
  const d = KontaktInput.parse(input);
  const [ex] = await tx`SELECT id FROM company_kontakt WHERE id = ${d.id}`;
  const fields = { name: d.name, funktion: d.funktion || null, telefon: d.telefon || null, email: d.email || null };
  if (ex) {
    const [row] = await tx`UPDATE company_kontakt SET ${tx(fields as never)} WHERE id = ${d.id} RETURNING *`;
    if (!row) throw new HttpError(403, 'Keine Berechtigung für diesen Kontakt');
    return row;
  }
  const [row] = await tx`
    INSERT INTO company_kontakt (id, tenant_id, company_id, name, funktion, telefon, email, created_by)
    VALUES (${d.id}, app.user_tenant(), ${d.company_id}, ${fields.name}, ${fields.funktion}, ${fields.telefon}, ${fields.email}, ${userId}) RETURNING *`;
  return row;
}

export async function removeKontakt(tx: TxSql, id: string) {
  const [row] = await tx`UPDATE company_kontakt SET aktiv = false WHERE id = ${id} RETURNING id`;
  if (!row) throw new HttpError(404, 'Kontakt nicht gefunden');
  return { ok: true };
}
