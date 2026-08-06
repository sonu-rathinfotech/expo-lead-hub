import "dotenv/config";
import { prisma } from "@elc/db";
import { emailService } from "./src/services/email.service";
import { refreshSettings } from "./src/services/settings.service";
import { notifyLeadReceived } from "./src/services/notification.service";
async function main() {
  await refreshSettings();
  console.log("isEmailConfigured:", emailService.isEmailConfigured());
  const ev = await prisma.event.findFirst({ where: { name: { contains: "Bombay", mode: "insensitive" } },
    include: { booths: { take:1 }, visitorTypes: { take:1 }, formDefinitions: { take:1 } } });
  if (!ev) { console.log("no BXC"); await prisma.$disconnect(); return; }
  const lead = await prisma.lead.create({ data: {
    eventId: ev.id, boothId: ev.booths[0].id, visitorTypeId: ev.visitorTypes[0].id,
    formDefinitionId: ev.formDefinitions[0].id, source: "MANUAL", playToken: "welctest01",
    rawFormData: { email: "sonu.prajapati@rathinfotech.com", contact_person: "Welcome Test", company_name: "Rath", mobile_number: "7277271727" },
  }});
  console.log("created lead", lead.id, "· calling notifyLeadReceived…");
  await notifyLeadReceived(lead.id);
  console.log("notifyLeadReceived returned. (no [email] error above = welcome sent OK)");
  await new Promise((r) => setTimeout(r, 3000));
  await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
  console.log("cleaned up.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR:", e?.message || e); process.exit(1); });
