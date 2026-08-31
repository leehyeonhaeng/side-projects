"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createItem,
  updateItem,
  deleteItem,
  addMovement,
} from "@/lib/inventory";
import { createAsset, assignAsset, collectAsset } from "@/lib/assets";

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
  const trackingType = String(formData.get("trackingType") || "quantity");
  if (!data.name) {
    redirect(`/items/new?error=${encodeURIComponent("품목명을 입력해주세요.")}`);
  }

  const id = createItem({ ...data, trackingType });
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

export async function createAssetAction(itemId, formData) {
  const memo = String(formData.get("memo") || "").trim();
  createAsset({ itemId, memo });
  revalidatePath(`/items/${itemId}`);
  revalidatePath("/items");
  redirect(`/items/${itemId}`);
}

export async function assignAssetAction(itemId, assetId, formData) {
  const partnerIdRaw = formData.get("partnerId");
  const partnerId = partnerIdRaw ? Number(partnerIdRaw) : null;
  const assignedAt = String(formData.get("assignedAt") || "");

  try {
    if (!partnerId) throw new Error("거래처를 선택해주세요.");
    assignAsset({ assetId, partnerId, assignedAt });
  } catch (error) {
    redirect(`/items/${itemId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/partners/${partnerId}`);
  redirect(`/items/${itemId}`);
}

export async function collectAssetAction(itemId, assetId, returnPath, formData) {
  const returnedAt = String(formData.get("returnedAt") || "");

  try {
    collectAsset({ assetId, returnedAt });
  } catch (error) {
    redirect(`${returnPath}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/items/${itemId}`);
  revalidatePath(returnPath);
  redirect(returnPath);
}
