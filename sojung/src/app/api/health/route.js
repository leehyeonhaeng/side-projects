import db from "@/lib/db";

export async function GET() {
  const row = db.prepare("SELECT sqlite_version() AS version").get();
  return Response.json({ status: "ok", sqliteVersion: row.version });
}
