import { prisma } from "@elc/db";

// A new event needs a booth + visitor type + form for the capture flow to work.
// These defaults make an event usable immediately (staff just scan cards); the
// booth/visitor-type pickers are hidden in Capture Lead, so their names don't
// matter to the user.
const DEFAULT_FIELDS = [
  { fieldKey: "contact_person", fieldType: "TEXT", label: "Name", isRequired: true, displayOrder: 0 },
  { fieldKey: "company_name", fieldType: "TEXT", label: "Company", isRequired: false, displayOrder: 1 },
  { fieldKey: "email", fieldType: "EMAIL", label: "Email", isRequired: false, displayOrder: 2 },
  { fieldKey: "mobile_number", fieldType: "PHONE", label: "Mobile", isRequired: false, displayOrder: 3 },
  { fieldKey: "designation", fieldType: "TEXT", label: "Designation", isRequired: false, displayOrder: 4 },
];

export interface ProvisionInput {
  name: string;
  venue?: string;
  organizer?: string;
  city?: string;
  country?: string;
  startDate?: Date;
  endDate?: Date;
  createdBy: string;
  activate?: boolean;
}

// Create a fully-usable event (event + booth + visitor type + form + fields).
export async function provisionEvent(input: ProvisionInput) {
  const now = new Date();
  const event = await prisma.event.create({
    data: {
      name: input.name,
      organizer: input.organizer || "Rath Infotech",
      venue: input.venue || input.name,
      city: input.city || "Mumbai",
      country: input.country || "India",
      startDate: input.startDate || now,
      endDate: input.endDate || now,
      status: input.activate ? "ACTIVE" : "DRAFT",
      createdBy: input.createdBy,
    },
  });

  await prisma.booth.create({ data: { eventId: event.id, name: "Booth", isActive: true } });
  await prisma.visitorType.create({
    data: { eventId: event.id, name: "Visitor", slug: "visitor", color: "#3B82F6", isActive: true, displayOrder: 0 },
  });
  const form = await prisma.formDefinition.create({ data: { eventId: event.id, name: "Lead Form", isActive: true } });
  await prisma.formField.createMany({
    data: DEFAULT_FIELDS.map((f) => ({ ...f, fieldType: f.fieldType as any, formDefinitionId: form.id })),
  });

  // Only one active event at a time — retire any others so the booth defaults
  // to this one.
  if (input.activate) {
    await prisma.event.updateMany({ where: { id: { not: event.id }, status: "ACTIVE" }, data: { status: "COMPLETED" } });
  }
  return event;
}

// Make an existing event the single ACTIVE one (retires the rest).
export async function activateEvent(eventId: string) {
  await prisma.$transaction([
    prisma.event.updateMany({ where: { status: "ACTIVE", id: { not: eventId } }, data: { status: "COMPLETED" } }),
    prisma.event.update({ where: { id: eventId }, data: { status: "ACTIVE" } }),
  ]);
}
