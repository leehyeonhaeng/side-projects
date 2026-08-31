import db from "@/lib/db";
import { listPartners, getPartnerDueStatus } from "@/lib/partners";
import { listOpenAssignmentsWithScheduledReturn, getAssetReturnStatus } from "@/lib/assets";

export function listNotifications({ unreadOnly } = {}) {
  const where = unreadOnly ? "WHERE n.is_read = 0" : "";
  return db
    .prepare(
      `
      SELECT
        n.*,
        p.name AS partner_name
      FROM notifications n
      LEFT JOIN partners p ON p.id = n.partner_id
      ${where}
      ORDER BY n.created_at DESC, n.id DESC
      `
    )
    .all();
}

export function countUnread() {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0")
    .get();
  return count;
}

export function markRead(id) {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
}

export function createNotification({
  type,
  partnerId,
  paymentId,
  stockMovementId,
  assetId,
  message,
}) {
  db.prepare(
    `
    INSERT INTO notifications (type, partner_id, payment_id, stock_movement_id, asset_id, message)
    VALUES (@type, @partnerId, @paymentId, @stockMovementId, @assetId, @message)
    `
  ).run({
    type,
    partnerId: partnerId ?? null,
    paymentId: paymentId ?? null,
    stockMovementId: stockMovementId ?? null,
    assetId: assetId ?? null,
    message,
  });
}

function notificationExists(type, stockMovementId) {
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE type = ? AND stock_movement_id = ?"
    )
    .get(type, stockMovementId);
  return count > 0;
}

function assetNotificationExists(type, assetId) {
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM notifications WHERE type = ? AND asset_id = ?")
    .get(type, assetId);
  return count > 0;
}

// 스케줄러가 없으므로, 알림 목록 화면을 방문할 때마다 현재 임박/초과 상태를 다시 계산해서
// 아직 기록되지 않은 것만 새로 쌓는다.
export function ensureDueSoonAndOverdueNotifications() {
  const partners = listPartners();
  for (const partner of partners) {
    const due = getPartnerDueStatus(partner.id);
    if (!due || due.status === "ok") continue;
    if (notificationExists(due.status, due.stockMovementId)) continue;

    const message =
      due.status === "overdue"
        ? `${partner.name} 결제기한(${due.dueDate})이 지났습니다.`
        : `${partner.name} 결제기한(${due.dueDate})이 임박했습니다.`;

    createNotification({
      type: due.status,
      partnerId: partner.id,
      stockMovementId: due.stockMovementId,
      message,
    });
  }
}

// 배치중인 개체의 예정 수거일 기준으로 임박/초과 알림을 쌓는다.
export function ensureAssetReturnNotifications() {
  const assignments = listOpenAssignmentsWithScheduledReturn();
  for (const a of assignments) {
    const status = getAssetReturnStatus(a.scheduled_return_at);
    if (!status || status === "ok") continue;

    const type = status === "overdue" ? "return_overdue" : "return_due_soon";
    if (assetNotificationExists(type, a.asset_id)) continue;

    const message =
      status === "overdue"
        ? `${a.partner_name}에 배치된 ${a.item_name}(${a.asset_code}) 수거 예정일(${a.scheduled_return_at})이 지났습니다.`
        : `${a.partner_name}에 배치된 ${a.item_name}(${a.asset_code}) 수거 예정일(${a.scheduled_return_at})이 임박했습니다.`;

    createNotification({
      type,
      partnerId: a.partner_id,
      assetId: a.asset_id,
      message,
    });
  }
}
