import db from "@/lib/db";

const STOCK_DELTA_SQL = `
  COALESCE(SUM(
    CASE m.type
      WHEN 'in' THEN m.quantity
      WHEN 'out' THEN -m.quantity
      WHEN 'adjust' THEN m.quantity
      ELSE 0
    END
  ), 0)
`;

// 개체(자산) 관리 품목은 입출고 수량이 아니라 assets 테이블의 재고 상태
// 개수로 현재 재고를 계산한다.
const CURRENT_STOCK_SQL = `
  CASE WHEN i.tracking_type = 'asset'
    THEN (SELECT COUNT(*) FROM assets a WHERE a.item_id = i.id AND a.status = 'in_stock')
    ELSE ${STOCK_DELTA_SQL}
  END
`;

export function listItemsWithStock({ query } = {}) {
  const where = query ? "WHERE i.name LIKE @q OR i.category LIKE @q OR i.spec LIKE @q" : "";
  const rows = db
    .prepare(
      `
      SELECT
        i.*,
        ${CURRENT_STOCK_SQL} AS current_stock
      FROM items i
      LEFT JOIN stock_movements m ON m.item_id = i.id
      ${where}
      GROUP BY i.id
      ORDER BY i.name
      `
    )
    .all(query ? { q: `%${query}%` } : {});
  return rows;
}

export function countLowStockItems() {
  const { count } = db
    .prepare(
      `
      SELECT COUNT(*) AS count FROM (
        SELECT i.id, ${CURRENT_STOCK_SQL} AS current_stock, i.min_stock
        FROM items i
        LEFT JOIN stock_movements m ON m.item_id = i.id
        GROUP BY i.id
        HAVING current_stock < i.min_stock
      )
      `
    )
    .get();
  return count;
}

export function getItemWithStock(id) {
  return db
    .prepare(
      `
      SELECT
        i.*,
        ${CURRENT_STOCK_SQL} AS current_stock
      FROM items i
      LEFT JOIN stock_movements m ON m.item_id = i.id
      WHERE i.id = @id
      GROUP BY i.id
      `
    )
    .get({ id });
}

export function createItem({ name, spec, unit, category, minStock, memo, trackingType }) {
  const result = db
    .prepare(
      `
      INSERT INTO items (name, spec, unit, category, min_stock, memo, tracking_type)
      VALUES (@name, @spec, @unit, @category, @minStock, @memo, @trackingType)
      `
    )
    .run({
      name,
      spec: spec || null,
      unit: unit || null,
      category: category || null,
      minStock: minStock ?? 0,
      memo: memo || null,
      trackingType: trackingType === "asset" ? "asset" : "quantity",
    });
  return result.lastInsertRowid;
}

export function updateItem(id, { name, spec, unit, category, minStock, memo }) {
  db.prepare(
    `
    UPDATE items
    SET name = @name,
        spec = @spec,
        unit = @unit,
        category = @category,
        min_stock = @minStock,
        memo = @memo,
        updated_at = datetime('now')
    WHERE id = @id
    `
  ).run({
    id,
    name,
    spec: spec || null,
    unit: unit || null,
    category: category || null,
    minStock: minStock ?? 0,
    memo: memo || null,
  });
}

export function deleteItem(id) {
  const { movementCount } = db
    .prepare("SELECT COUNT(*) AS movementCount FROM stock_movements WHERE item_id = ?")
    .get(id);
  const { assetCount } = db
    .prepare("SELECT COUNT(*) AS assetCount FROM assets WHERE item_id = ?")
    .get(id);
  if (movementCount > 0 || assetCount > 0) {
    throw new Error("입출고·개체 이력이 있는 품목은 삭제할 수 없습니다.");
  }
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
}

export function listMovements(itemId) {
  return db
    .prepare(
      `
      SELECT
        m.*,
        p.name AS partner_name
      FROM stock_movements m
      LEFT JOIN partners p ON p.id = m.partner_id
      WHERE m.item_id = ?
      ORDER BY m.moved_at DESC, m.id DESC
      `
    )
    .all(itemId);
}

export function addMovement({
  itemId,
  type,
  quantity,
  unitPrice,
  memo,
  movedAt,
  partnerId,
  dueDate,
}) {
  if (!["in", "out", "adjust"].includes(type)) {
    throw new Error("올바르지 않은 입출고 유형입니다.");
  }
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new Error("수량을 올바르게 입력해주세요.");
  }
  if (type !== "adjust" && quantity < 0) {
    throw new Error("입고/출고 수량은 0보다 커야 합니다.");
  }

  db.prepare(
    `
    INSERT INTO stock_movements (item_id, type, quantity, unit_price, memo, moved_at, partner_id, due_date)
    VALUES (@itemId, @type, @quantity, @unitPrice, @memo, @movedAt, @partnerId, @dueDate)
    `
  ).run({
    itemId,
    type,
    quantity,
    unitPrice: unitPrice ?? null,
    memo: memo || null,
    dueDate: dueDate ?? null,
    movedAt,
    partnerId: partnerId ?? null,
  });
}
