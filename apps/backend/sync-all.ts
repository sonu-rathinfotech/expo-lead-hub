import "dotenv/config";
import { prisma } from "@elc/db";
import { refreshSettings } from "./src/services/settings.service";
import { syncUnsyncedLeads } from "./src/services/sheets.service";
async function main() {
  await refreshSettings();
  const reset = await prisma.lead.updateMany({ data: { sheetsSynced: false } });
  console.log("reset sheetsSynced for", reset.count, "leads · syncing all now…");
  const r = await syncUnsyncedLeads();
  console.log("SYNC RESULT:", JSON.stringify(r));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR:", e?.message || e); process.exit(1); });
