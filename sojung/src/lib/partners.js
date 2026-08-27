import db from "@/lib/db";

export function listPartners({ query } = {}) {
  const where = query
    ? "WHERE name LIKE @q OR contact_name LIKE @q OR business_no LIKE @q"
    : "";
  return db
    .prepare(`SELECT * FROM partners ${where} ORDER BY name`)
    .all(query ? { q: `%${query}%` } : {});
}

export function getPartner(id) {
  return db.prepare("SELECT * FROM partners WHERE id = ?").get(id);
}

export function createPartner({ name, type, contactName, phone, businessNo, memo }) {
  const result = db
    .prepare(
      `
      INSERT INTO partners (name, type, contact_name, phone, business_no, memo)
      VALUES (@name, @type, @contactName, @phone, @businessNo, @memo)
      `
    )
    .run({
      name,
      type,
      contactName: contactName || null,
      phone: phone || null,
      businessNo: businessNo || null,
      memo: memo || null,
    });
  return result.lastInsertRowid;
}

export function updatePartner(id, { name, type, contactName, phone, businessNo, memo }) {
  db.prepare(
    `
    UPDATE partners
    SET name = @name,
        type = @type,
        contact_name = @contactName,
        phone = @phone,
        business_no = @businessNo,
        memo = @memo,
        updated_at = datetime('now')
    WHERE id = @id
    `
  ).run({
    id,
    name,
    type,
    contactName: contactName || null,
    phone: phone || null,
    businessNo: businessNo || null,
    memo: memo || null,
  });
}

export function deletePartner(id) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE partner_id = ?")
    .get(id);
  if (count > 0) {
    throw new Error("연결된 거래 내역이 있는 거래처는 삭제할 수 없습니다.");
  }
  db.prepare("DELETE FROM partners WHERE id = ?").run(id);
}

export function listMovementsByPartner(partnerId) {
  return db
    .prepare(
      `
      SELECT
        m.*,
        i.name AS item_name,
        i.unit AS item_unit
      FROM stock_movements m
      JOIN items i ON i.id = m.item_id
      WHERE m.partner_id = ?
      ORDER BY m.moved_at DESC, m.id DESC
      `
    )
    .all(partnerId);
}
