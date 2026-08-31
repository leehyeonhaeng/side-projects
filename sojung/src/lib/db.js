import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "sojung.db");

let db = globalThis.__sojungDb;
if (!db) {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      spec TEXT,
      unit TEXT,
      category TEXT,
      min_stock REAL NOT NULL DEFAULT 0,
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('supplier', 'customer', 'both')),
      contact_name TEXT,
      phone TEXT,
      business_no TEXT,
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust')),
      quantity REAL NOT NULL,
      unit_price INTEGER,
      memo TEXT,
      moved_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id INTEGER REFERENCES partners(id) ON DELETE RESTRICT,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      amount INTEGER NOT NULL,
      paid_at TEXT NOT NULL,
      depositor_name TEXT,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bank_import')),
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payments_partner_id ON payments(partner_id);

    -- type에는 CHECK 제약을 두지 않는다 — SQLite는 CHECK를 ALTER TABLE로
    -- 못 바꿔서 새 알림 종류가 생길 때마다 테이블을 통째로 다시 만들어야
    -- 했고, 그 과정에서 실제로 다른 테이블의 FK를 깨뜨리는 사고가 났다.
    -- 유효한 type 값은 lib/notifications.js에서 앱 레벨로만 관리한다.
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
      payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
      stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE CASCADE,
      asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
      item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      business_no TEXT,
      address TEXT,
      phone TEXT
    );
    INSERT OR IGNORE INTO company_settings (id) VALUES (1);

    -- asset_code는 재고로 쌓아둘 때는 비워두고(아직 특정 개체로 구분할 필요가
    -- 없음), 실제로 거래처에 배치되는 순간 처음 코드가 부여된다. 이후 수거해도
    -- 코드는 그대로 유지되어 그 물리적 기기의 이력을 계속 추적할 수 있다.
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
      asset_code TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'deployed')),
      current_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assets_item_id ON assets(item_id);
    CREATE INDEX IF NOT EXISTS idx_assets_current_partner_id ON assets(current_partner_id);

    CREATE TABLE IF NOT EXISTS asset_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
      assigned_at TEXT NOT NULL,
      scheduled_return_at TEXT,
      returned_at TEXT,
      memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset_id ON asset_assignments(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_assignments_partner_id ON asset_assignments(partner_id);
  `);

  function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((col) => col.name === column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      // Another process (e.g. a parallel build worker) may have already
      // added the column between the check above and this statement.
      if (!/duplicate column name/i.test(error.message)) {
        throw error;
      }
    }
  }

  addColumnIfMissing(
    "stock_movements",
    "partner_id",
    "INTEGER REFERENCES partners(id) ON DELETE RESTRICT"
  );
  addColumnIfMissing("stock_movements", "due_date", "TEXT");
  addColumnIfMissing("company_settings", "login_password", "TEXT");
  addColumnIfMissing("items", "tracking_type", "TEXT NOT NULL DEFAULT 'quantity'");
  addColumnIfMissing("asset_assignments", "scheduled_return_at", "TEXT");

  // 테이블을 rename → 재생성 → drop 하는 방식으로 제약을 바꿀 때, SQLite가
  // 기본으로 다른 테이블의 FK 참조 텍스트를 rename된 이름을 따라가도록 고쳐
  // 버린다(예: asset_assignments.asset_id REFERENCES "assets" → "assets_old").
  // 그 상태에서 옛 이름 테이블을 드롭하면 FK가 존재하지 않는 테이블을 가리키게
  // 되어 이후 그 테이블에 대한 조작이 깨진다. legacy_alter_table을 켜두면
  // rename이 다른 테이블의 참조 텍스트를 건드리지 않으므로, 원래 이름으로
  // 다시 만든 새 테이블을 그대로 참조하게 된다.
  function renameRecreateDrop(sql) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    try {
      db.exec(sql);
    } finally {
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
    }
  }

  // notifications.type의 CHECK 제약은 ALTER TABLE로 바꿀 수 없으므로,
  // 이미 만들어진(구버전) 테이블이면 새 제약으로 통째로 다시 만든다.
  function migrateNotificationsForAssetReturns() {
    const columns = db.prepare("PRAGMA table_info(notifications)").all();
    if (columns.some((col) => col.name === "asset_id")) return;
    renameRecreateDrop(`
      ALTER TABLE notifications RENAME TO notifications_old;
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('payment_matched', 'payment_unmatched', 'due_soon', 'overdue', 'return_due_soon', 'return_overdue')),
        partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
        payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
        stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE CASCADE,
        asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO notifications (id, type, partner_id, payment_id, stock_movement_id, message, is_read, created_at)
        SELECT id, type, partner_id, payment_id, stock_movement_id, message, is_read, created_at FROM notifications_old;
      DROP TABLE notifications_old;
    `);
  }
  migrateNotificationsForAssetReturns();

  // notifications.type의 CHECK 제약을 완전히 없애고 item_id를 추가한다.
  // CHECK를 없애 두면 앞으로 알림 종류가 늘어나도 이런 재생성 마이그레이션이
  // 다시는 필요 없다.
  function migrateNotificationsDropTypeCheck() {
    const columns = db.prepare("PRAGMA table_info(notifications)").all();
    if (columns.some((col) => col.name === "item_id")) return;
    renameRecreateDrop(`
      ALTER TABLE notifications RENAME TO notifications_old;
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        partner_id INTEGER REFERENCES partners(id) ON DELETE CASCADE,
        payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
        stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE CASCADE,
        asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO notifications (id, type, partner_id, payment_id, stock_movement_id, asset_id, message, is_read, created_at)
        SELECT id, type, partner_id, payment_id, stock_movement_id, asset_id, message, is_read, created_at FROM notifications_old;
      DROP TABLE notifications_old;
    `);
  }
  migrateNotificationsDropTypeCheck();

  // assets.asset_code의 NOT NULL 제약도 ALTER TABLE로 못 바꾸므로 같은 방식으로
  // 다시 만든다. asset_assignments/notifications가 assets(id)를 참조하므로
  // renameRecreateDrop으로 그 참조가 깨지지 않게 처리한다.
  function migrateAssetsCodeNullable() {
    const columns = db.prepare("PRAGMA table_info(assets)").all();
    const codeColumn = columns.find((col) => col.name === "asset_code");
    if (!codeColumn || codeColumn.notnull === 0) return;
    renameRecreateDrop(`
      ALTER TABLE assets RENAME TO assets_old;
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
        asset_code TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'deployed')),
        current_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
        memo TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO assets SELECT * FROM assets_old;
      DROP TABLE assets_old;
    `);
  }
  migrateAssetsCodeNullable();

  // 위의 두 마이그레이션이 legacy_alter_table 없이 이미 실행된 적이 있다면
  // asset_assignments/notifications의 FK가 "assets_old"를 가리키는 채로
  // 남아있을 수 있다. 그런 경우를 감지해서 같은 방식으로 바로잡는다.
  function repairDanglingAssetsOldReferences() {
    const broken = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql LIKE '%\"assets_old\"%'"
      )
      .all();
    if (broken.length === 0) return;
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets_old'").get()) {
      // assets_old가 아직 남아있다면(드롭이 실패했던 경우) 그것부터 정리한다.
      db.pragma("foreign_keys = OFF");
      db.exec("DROP TABLE IF EXISTS assets_old");
      db.pragma("foreign_keys = ON");
    }
    for (const table of broken) {
      const fixedSql = table.sql.replace(/"assets_old"/g, '"assets"');
      renameRecreateDrop(`
        ALTER TABLE ${table.name} RENAME TO ${table.name}_repair_old;
        ${fixedSql};
        INSERT INTO ${table.name} SELECT * FROM ${table.name}_repair_old;
        DROP TABLE ${table.name}_repair_old;
      `);
    }
  }
  repairDanglingAssetsOldReferences();

  // rename → 재생성 → drop 방식의 마이그레이션은 그 테이블에 걸려있던 인덱스도
  // 함께 날려버리므로(인덱스는 rename을 따라갔다가 drop과 함께 사라짐),
  // 모든 인덱스를 여기서 한 번에 다시(이미 있으면 그대로 두고) 만든다.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_movements_partner_id ON stock_movements(partner_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id);
    CREATE INDEX IF NOT EXISTS idx_payments_partner_id ON payments(partner_id);
    CREATE INDEX IF NOT EXISTS idx_assets_item_id ON assets(item_id);
    CREATE INDEX IF NOT EXISTS idx_assets_current_partner_id ON assets(current_partner_id);
    CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset_id ON asset_assignments(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_assignments_partner_id ON asset_assignments(partner_id);
  `);

  globalThis.__sojungDb = db;
}

export default db;
