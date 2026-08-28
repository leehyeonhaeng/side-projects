import { parse } from "csv-parse/sync";
import iconv from "iconv-lite";
import db from "@/lib/db";
import { listPartners } from "@/lib/partners";
import { createNotification } from "@/lib/notifications";

export function listPayments({ matched } = {}) {
  let where = "";
  if (matched === true) where = "WHERE p.partner_id IS NOT NULL";
  if (matched === false) where = "WHERE p.partner_id IS NULL";
  return db
    .prepare(
      `
      SELECT
        p.*,
        pt.name AS partner_name
      FROM payments p
      LEFT JOIN partners pt ON pt.id = p.partner_id
      ${where}
      ORDER BY p.paid_at DESC, p.id DESC
      `
    )
    .all();
}

export function listPaymentsByPartner(partnerId) {
  return db
    .prepare(
      `
      SELECT * FROM payments
      WHERE partner_id = ?
      ORDER BY paid_at DESC, id DESC
      `
    )
    .all(partnerId);
}

export function getPayment(id) {
  return db
    .prepare(
      `
      SELECT
        p.*,
        pt.name AS partner_name
      FROM payments p
      LEFT JOIN partners pt ON pt.id = p.partner_id
      WHERE p.id = ?
      `
    )
    .get(id);
}

export function createPayment({ partnerId, direction, amount, paidAt, memo }) {
  const result = db
    .prepare(
      `
      INSERT INTO payments (partner_id, direction, amount, paid_at, source, memo)
      VALUES (@partnerId, @direction, @amount, @paidAt, 'manual', @memo)
      `
    )
    .run({
      partnerId: partnerId ?? null,
      direction,
      amount,
      paidAt,
      memo: memo || null,
    });
  return result.lastInsertRowid;
}

export function matchPayment(paymentId, partnerId) {
  db.prepare("UPDATE payments SET partner_id = ? WHERE id = ?").run(partnerId, paymentId);
}

// --- 은행 거래내역 파일 업로드/매칭 ---

const DATE_HEADERS = ["거래일시", "거래일자", "거래일"];
const DEPOSIT_HEADERS = ["맡기신금액", "입금액", "입금"];
const WITHDRAW_HEADERS = ["찾으신금액", "출금액", "출금"];
const MEMO_HEADERS = ["적요", "기재내용", "거래내용", "내용", "보낸분"];

function findHeaderKey(row, candidates) {
  const keys = Object.keys(row);
  return keys.find((key) =>
    candidates.some((c) => key.replace(/\s/g, "") === c.replace(/\s/g, ""))
  );
}

function parseAmount(value) {
  if (!value) return 0;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function decodeBankFile(buffer) {
  const utf8Text = buffer.toString("utf8");
  if (!utf8Text.includes("�")) return utf8Text;
  return iconv.decode(buffer, "euc-kr");
}

function matchPartnerByText(text, partners) {
  if (!text) return null;
  const normalized = text.replace(/\s/g, "");
  const matches = partners.filter((p) => {
    const name = (p.name || "").replace(/\s/g, "");
    const contact = (p.contact_name || "").replace(/\s/g, "");
    return (
      (name && (normalized.includes(name) || name.includes(normalized))) ||
      (contact && (normalized.includes(contact) || contact.includes(normalized)))
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

export function importBankStatement(buffer) {
  const text = decodeBankFile(buffer);
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const partners = listPartners();
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of rows) {
    const dateKey = findHeaderKey(row, DATE_HEADERS);
    const depositKey = findHeaderKey(row, DEPOSIT_HEADERS);
    const withdrawKey = findHeaderKey(row, WITHDRAW_HEADERS);
    const memoKey = findHeaderKey(row, MEMO_HEADERS);

    const paidAt = parseDate(dateKey ? row[dateKey] : null);
    const memoText = memoKey ? row[memoKey] : "";
    if (!paidAt) continue;

    const depositAmount = parseAmount(depositKey ? row[depositKey] : null);
    const withdrawAmount = parseAmount(withdrawKey ? row[withdrawKey] : null);

    if (depositAmount > 0) {
      const partner = matchPartnerByText(memoText, partners);
      const paymentId = db
        .prepare(
          `
          INSERT INTO payments (partner_id, direction, amount, paid_at, depositor_name, source)
          VALUES (@partnerId, 'in', @amount, @paidAt, @depositorName, 'bank_import')
          `
        )
        .run({
          partnerId: partner ? partner.id : null,
          amount: depositAmount,
          paidAt,
          depositorName: memoText || null,
        }).lastInsertRowid;

      if (partner) {
        matchedCount += 1;
        createNotification({
          type: "payment_matched",
          partnerId: partner.id,
          paymentId,
          message: `${partner.name}로부터 ${depositAmount.toLocaleString()}원 입금이 확인되었습니다.`,
        });
      } else {
        unmatchedCount += 1;
        createNotification({
          type: "payment_unmatched",
          paymentId,
          message: `입금자명 "${memoText || "확인불가"}"와 일치하는 거래처를 찾지 못했습니다. (${depositAmount.toLocaleString()}원)`,
        });
      }
    }

    if (withdrawAmount > 0) {
      const partner = matchPartnerByText(memoText, partners);
      db.prepare(
        `
        INSERT INTO payments (partner_id, direction, amount, paid_at, depositor_name, source)
        VALUES (@partnerId, 'out', @amount, @paidAt, @depositorName, 'bank_import')
        `
      ).run({
        partnerId: partner ? partner.id : null,
        amount: withdrawAmount,
        paidAt,
        depositorName: memoText || null,
      });
    }
  }

  return { matchedCount, unmatchedCount };
}
