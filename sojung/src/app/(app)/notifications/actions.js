"use server";

import { revalidatePath } from "next/cache";
import { markRead } from "@/lib/notifications";

export async function markReadAction(id) {
  markRead(id);
  revalidatePath("/notifications");
}
