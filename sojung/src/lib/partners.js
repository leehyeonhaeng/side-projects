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
  const { movementCount } = db
    .prepare("SELECT COUNT(*) AS movementCount FROM stock_movements WHERE partner_id = ?")
    .get(id);
  const { paymentCount } = db
    .prepare("SELECT COUNT(*) AS paymentCount FROM payments WHERE partner_id = ?")
    .get(id);
  if (movementCount > 0 || paymentCount > 0) {
    throw new Error("연결된 거래 내역이 있는 거래처는 삭제할 수 없습니다.");
  }
  db.prepare("DELETE FROM partners WHERE id = ?").run(id);
}

// 양수 = 미수금(거래처가 우리에게 줄 돈), 음수 = 미지급금(우리가 거래처에게 줄 돈)
export function getPartnerBalance(partnerId) {
  const { movementNet } = db
    .prepare(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'out' THEN quantity * unit_price
          WHEN type = 'in' THEN -(quantity * unit_price)
          ELSE 0
        END
      ), 0) AS movementNet
      FROM stock_movements
      WHERE partner_id = ? AND unit_price IS NOT NULL
      `
    )
    .get(partnerId);

  const { paymentNet } = db
    .prepare(
      `
      SELECT COALESCE(SUM(
        CASE
          WHEN direction = 'in' THEN -amount
          WHEN direction = 'out' THEN amount
          ELSE 0
        END
      ), 0) AS paymentNet
      FROM payments
      WHERE partner_id = ?
      `
    )
    .get(partnerId);

  return movementNet + paymentNet;
}

const DUE_SOON_DAYS = 3;

// 미수금이 있는 거래처에 대해, 결제기한이 걸린 출고 건 중 가장 이른 것을 기준으로
// 임박/초과를 근사 판단한다 (건별 정밀 정산 상태 추적은 하지 않음).
export function getPartnerDueStatus(partnerId, today = new Date().toISOString().slice(0, 10)) {
  const balance = getPartnerBalance(partnerId);
  if (balance <= 0) return null;

  const nearest = db
    .prepare(
      `
      SELECT id, due_date
      FROM stock_movements
      WHERE partner_id = ? AND type = 'out' AND due_date IS NOT NULL
      ORDER BY due_date ASC
      LIMIT 1
      `
    )
    .get(partnerId);

  if (!nearest) return null;

  const dueDate = new Date(nearest.due_date);
  const todayDate = new Date(today);
  const diffDays = Math.ceil((dueDate - todayDate) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: "overdue", dueDate: nearest.due_date, stockMovementId: nearest.id };
  }
  if (diffDays <= DUE_SOON_DAYS) {
    return { status: "due_soon", dueDate: nearest.due_date, stockMovementId: nearest.id };
  }
  return { status: "ok", dueDate: nearest.due_date, stockMovementId: nearest.id };
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
