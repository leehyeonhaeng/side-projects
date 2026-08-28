import db from "@/lib/db";
import { listPartners, getPartnerDueStatus } from "@/lib/partners";

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

export function createNotification({ type, partnerId, paymentId, stockMovementId, message }) {
  db.prepare(
    `
    INSERT INTO notifications (type, partner_id, payment_id, stock_movement_id, message)
    VALUES (@type, @partnerId, @paymentId, @stockMovementId, @message)
    `
  ).run({
    type,
    partnerId: partnerId ?? null,
    paymentId: paymentId ?? null,
    stockMovementId: stockMovementId ?? null,
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
