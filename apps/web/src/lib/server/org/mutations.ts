export function buildTouchOrganizationStatement(
  db: D1Database,
  orgId: string,
  now = Date.now()
): D1PreparedStatement {
  return db.prepare(`
    UPDATE organizations
    SET updated_at = CASE
      WHEN updated_at >= ? THEN updated_at + 1
      ELSE ?
    END
    WHERE id = ?
  `).bind(now, now, orgId);
}

export async function touchOrganizationUpdatedAt(
  db: D1Database,
  orgId: string,
  now = Date.now()
): Promise<void> {
  await buildTouchOrganizationStatement(db, orgId, now).run();
}
