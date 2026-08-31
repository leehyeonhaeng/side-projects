import db from "@/lib/db";

export function listAssetsByItem(itemId) {
  return db
    .prepare(
      `
      SELECT a.*, p.name AS partner_name
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

export function createAsset({ itemId, memo }) {
  const result = db
    .prepare(
      `
      INSERT INTO assets (item_id, asset_code, status, memo)
      VALUES (@itemId, '', 'in_stock', @memo)
      `
    )
    .run({ itemId, memo: memo || null });
  const id = result.lastInsertRowid;
  const assetCode = `A-${String(id).padStart(6, "0")}`;
  db.prepare("UPDATE assets SET asset_code = ? WHERE id = ?").run(assetCode, id);
  return id;
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

export function assignAsset({ assetId, partnerId, assignedAt, memo }) {
  const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId);
  if (!asset) throw new Error("개체를 찾을 수 없습니다.");
  if (asset.status !== "in_stock") {
    throw new Error("재고 상태의 개체만 배치할 수 있습니다.");
  }

  db.prepare(
    `
    INSERT INTO asset_assignments (asset_id, partner_id, assigned_at, memo)
    VALUES (@assetId, @partnerId, @assignedAt, @memo)
    `
  ).run({ assetId, partnerId, assignedAt, memo: memo || null });

  db.prepare(
    "UPDATE assets SET status = 'deployed', current_partner_id = @partnerId WHERE id = @assetId"
  ).run({ assetId, partnerId });
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
        (
          SELECT aa.assigned_at FROM asset_assignments aa
          WHERE aa.asset_id = a.id AND aa.returned_at IS NULL
          ORDER BY aa.id DESC LIMIT 1
        ) AS assigned_at
      FROM assets a
      JOIN items i ON i.id = a.item_id
      WHERE a.current_partner_id = ? AND a.status = 'deployed'
      ORDER BY a.id DESC
      `
    )
    .all(partnerId);
}
