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
  `);

  const stockMovementColumns = db.prepare("PRAGMA table_info(stock_movements)").all();
  const hasPartnerId = stockMovementColumns.some((col) => col.name === "partner_id");
  if (!hasPartnerId) {
    try {
      db.exec(
        "ALTER TABLE stock_movements ADD COLUMN partner_id INTEGER REFERENCES partners(id) ON DELETE RESTRICT"
      );
    } catch (error) {
      // Another process (e.g. a parallel build worker) may have already
      // added the column between the check above and this statement.
      if (!/duplicate column name/i.test(error.message)) {
        throw error;
      }
    }
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stock_movements_partner_id ON stock_movements(partner_id)"
  );

  globalThis.__sojungDb = db;
}

export default db;
