"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createItem,
  updateItem,
  deleteItem,
  addMovement,
} from "@/lib/inventory";

function parseItemForm(formData) {
  const name = String(formData.get("name") || "").trim();
  const minStock = Number(formData.get("minStock") || 0);
  return {
    name,
    spec: String(formData.get("spec") || "").trim(),
    unit: String(formData.get("unit") || "").trim(),
    category: String(formData.get("category") || "").trim(),
    minStock: Number.isFinite(minStock) ? minStock : 0,
    memo: String(formData.get("memo") || "").trim(),
  };
}

export async function createItemAction(formData) {
  const data = parseItemForm(formData);
  if (!data.name) {
    redirect(`/items/new?error=${encodeURIComponent("품목명을 입력해주세요.")}`);
  }

  const id = createItem(data);
  revalidatePath("/items");
  redirect(`/items/${id}`);
}

export async function updateItemAction(id, formData) {
  const data = parseItemForm(formData);
  if (!data.name) {
    redirect(`/items/${id}/edit?error=${encodeURIComponent("품목명을 입력해주세요.")}`);
  }

  updateItem(id, data);
  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  redirect(`/items/${id}`);
}

export async function deleteItemAction(id) {
  try {
    deleteItem(id);
  } catch (error) {
    redirect(`/items/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/items");
  redirect("/items");
}

export async function addMovementAction(itemId, formData) {
  const type = String(formData.get("type") || "");
  const quantity = Number(formData.get("quantity"));
  const unitPriceRaw = formData.get("unitPrice");
  const unitPrice = unitPriceRaw ? Number(unitPriceRaw) : null;
  const memo = String(formData.get("memo") || "").trim();
  const movedAt = String(formData.get("movedAt") || "");
  const partnerIdRaw = formData.get("partnerId");
  const partnerId = partnerIdRaw ? Number(partnerIdRaw) : null;
  const dueDate = String(formData.get("dueDate") || "").trim() || null;

  try {
    addMovement({ itemId, type, quantity, unitPrice, memo, movedAt, partnerId, dueDate });
  } catch (error) {
    redirect(`/items/${itemId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/items/${itemId}`);
  revalidatePath("/items");
  redirect(`/items/${itemId}`);
}
