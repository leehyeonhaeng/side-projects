import db from "@/lib/db";

export function getCompanySettings() {
  return db.prepare("SELECT * FROM company_settings WHERE id = 1").get();
}

export function updateCompanySettings({ name, businessNo, address, phone }) {
  db.prepare(
    `
    UPDATE company_settings
    SET name = @name,
        business_no = @businessNo,
        address = @address,
        phone = @phone
    WHERE id = 1
    `
  ).run({
    name: name || null,
    businessNo: businessNo || null,
    address: address || null,
    phone: phone || null,
  });
}
