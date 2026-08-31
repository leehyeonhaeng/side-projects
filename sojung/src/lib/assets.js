import db from "@/lib/db";

const OPEN_ASSIGNMENT_SUBQUERY = (column) => `
  (
    SELECT aa.${column} FROM asset_assignments aa
    WHERE aa.asset_id = a.id AND aa.returned_at IS NULL
    ORDER BY aa.id DESC LIMIT 1
  )
`;

export function listAssetsByItem(itemId) {
  return db
    .prepare(
      `
      SELECT a.*, p.name AS partner_name,
        ${OPEN_ASSIGNMENT_SUBQUERY("assigned_at")} AS assigned_at,
        ${OPEN_ASSIGNMENT_SUBQUERY("scheduled_return_at")} AS scheduled_return_at
      FROM assets a
      LEFT JOIN partners p ON p.id = a.current_partner_id
      WHERE a.item_id = ?
      ORDER BY a.id DESC
      `
    )
    .all(itemId);
}

export function getAssetStockCounts(itemId) {
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) AS inStock,
        SUM(CASE WHEN status = 'deployed' THEN 1 ELSE 0 END) AS deployed
      FROM assets
      WHERE item_id = ?
      `
    )
    .get(itemId);
  return {
    total: row.total,
    inStock: row.inStock || 0,
    deployed: row.deployed || 0,
  };
}

export function getAsset(id) {
  return db
    .prepare(
      `
      SELECT a.*, i.name AS item_name, i.spec AS item_spec, i.unit AS item_unit,
        p.name AS partner_name
      FROM assets a
      JOIN items i ON i.id = a.item_id
      LEFT JOIN partners p ON p.id = a.current_partner_id
      WHERE a.id = ?
      `
    )
    .get(id);
}

// 재고에 수량만큼 "무기명" 개체를 쌓아둔다 — 코드는 아직 없고, 배치되는
// 순간 처음 부여된다.
export function addAssetStock({ itemId, quantity, memo }) {
  const insert = db.prepare(
    `
    INSERT INTO assets (item_id, asset_code, status, memo)
    VALUES (@itemId, NULL, 'in_stock', @memo)
    `
  );
  const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i += 1) {
      insert.run({ itemId, memo: memo || null });
    }
  });
  insertMany(quantity);
}

export function deleteAsset(id) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM asset_assignments WHERE asset_id = ?")
    .get(id);
  if (count > 0) {
    throw new Error("배치 이력이 있는 개체는 삭제할 수 없습니다.");
  }
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
}

// 재고 중 하나를 골라 거래처에 배치한다. 이미 코드가 있던(예전에 배치됐다가
// 돌아온) 개체를 먼저 쓰고, 없으면 무기명 재고 중 하나를 골라 이때 처음으로
// 코드를 부여한다 — 그 코드는 이후 반납해도 그대로 유지된다.
export function assignNextAvailableAsset({ itemId, partnerId, assignedAt, scheduledReturnAt, memo }) {
  const asset = db
    .prepare(
      `
      SELECT * FROM assets
      WHERE item_id = ? AND status = 'in_stock'
      ORDER BY (asset_code IS NULL) ASC, id ASC
      LIMIT 1
      `
    )
    .get(itemId);
  if (!asset) {
    throw new Error("배치할 수 있는 재고가 없습니다.");
  }

  if (!asset.asset_code) {
    const assetCode = `A-${String(asset.id).padStart(6, "0")}`;
    db.prepare("UPDATE assets SET asset_code = ? WHERE id = ?").run(assetCode, asset.id);
  }

  db.prepare(
    `
    INSERT INTO asset_assignments (asset_id, partner_id, assigned_at, scheduled_return_at, memo)
    VALUES (@assetId, @partnerId, @assignedAt, @scheduledReturnAt, @memo)
    `
  ).run({
    assetId: asset.id,
    partnerId,
    assignedAt,
    scheduledReturnAt: scheduledReturnAt || null,
    memo: memo || null,
  });

  db.prepare(
    "UPDATE assets SET status = 'deployed', current_partner_id = @partnerId WHERE id = @assetId"
  ).run({ assetId: asset.id, partnerId });

  return asset.id;
}

// 배치 중 예정 수거일만 바꾼다 — 실제로 수거하는 것과는 별개의 동작.
export function updateScheduledReturn({ assetId, scheduledReturnAt }) {
  const assignment = db
    .prepare(
      `
      SELECT * FROM asset_assignments
      WHERE asset_id = ? AND returned_at IS NULL
      ORDER BY id DESC LIMIT 1
      `
    )
    .get(assetId);
  if (!assignment) {
    throw new Error("진행 중인 배치를 찾을 수 없습니다.");
  }
  db.prepare("UPDATE asset_assignments SET scheduled_return_at = ? WHERE id = ?").run(
    scheduledReturnAt || null,
    assignment.id
  );
}

export function collectAsset({ assetId, returnedAt }) {
  const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
  if (!asset) throw new Error("개체를 찾을 수 없습니다.");
  if (asset.status !== "deployed") {
    throw new Error("배치된 개체만 수거할 수 있습니다.");
  }

  const assignment = db
    .prepare(
      `
      SELECT * FROM asset_assignments
      WHERE asset_id = ? AND returned_at IS NULL
      ORDER BY id DESC LIMIT 1
      `
    )
    .get(assetId);
  if (assignment) {
    db.prepare("UPDATE asset_assignments SET returned_at = ? WHERE id = ?").run(
      returnedAt,
      assignment.id
    );
  }

  db.prepare(
    "UPDATE assets SET status = 'in_stock', current_partner_id = NULL WHERE id = ?"
  ).run(assetId);
}

export function listDeployedAssetsByPartner(partnerId) {
  return db
    .prepare(
      `
      SELECT a.*, i.name AS item_name, i.spec AS item_spec,
        ${OPEN_ASSIGNMENT_SUBQUERY("assigned_at")} AS assigned_at,
        ${OPEN_ASSIGNMENT_SUBQUERY("scheduled_return_at")} AS scheduled_return_at
      FROM assets a
      JOIN items i ON i.id = a.item_id
      WHERE a.current_partner_id = ? AND a.status = 'deployed'
      ORDER BY a.id DESC
      `
    )
    .all(partnerId);
}

const RETURN_DUE_SOON_DAYS = 3;

// 예정 수거일 기준으로 임박/초과를 판단한다. getPartnerDueStatus와 같은 규칙.
export function getAssetReturnStatus(scheduledReturnAt, today = new Date().toISOString().slice(0, 10)) {
  if (!scheduledReturnAt) return null;
  const diffDays = Math.ceil(
    (new Date(scheduledReturnAt) - new Date(today)) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 0) return "overdue";
  if (diffDays <= RETURN_DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

// 알림 생성용 — 예정 수거일이 잡힌 배치중 개체 전체.
export function listOpenAssignmentsWithScheduledReturn() {
  return db
    .prepare(
      `
      SELECT aa.id AS assignment_id, aa.asset_id, aa.scheduled_return_at,
        a.asset_code, a.item_id, i.name AS item_name,
        p.id AS partner_id, p.name AS partner_name
      FROM asset_assignments aa
      JOIN assets a ON a.id = aa.asset_id
      JOIN items i ON i.id = a.item_id
      JOIN partners p ON p.id = aa.partner_id
      WHERE aa.returned_at IS NULL AND aa.scheduled_return_at IS NOT NULL
      `
    )
    .all();
}
