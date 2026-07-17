import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Loader2, Gamepad2, Search } from "lucide-react";
import { publicApi } from "../lib/api-client";
import { DynamicForm, type FormFieldDef } from "../components/DynamicForm";
import { applyContactToFields, bniToContact, type Contact } from "../lib/contact-fields";

interface FormPayload {
  qrCode: { id: string; shortCode: string; eventId: string; boothId: string; visitorTypeId: string };
  event: { id: string; name: string; bannerImageUrl?: string | null; logoUrl?: string | null };
  booth: { id: string; name: string };
  visitorType: { id: string; name: string; slug: string };
  form: { id: string; name: string; fields: FormFieldDef[] } | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 p-4">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

export function PublicLeadForm() {
  const { shortCode } = useParams<{ shortCode: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [playToken, setPlayToken] = useState<string | null>(null);

  // Quick-start: prefill the form from a phone lookup.
  const [prefillFields, setPrefillFields] = useState<FormFieldDef[] | null>(null);
  const [prefillNonce, setPrefillNonce] = useState(0); // bump to remount DynamicForm with new defaults
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<null | "phone">(null);
  const [quickMsg, setQuickMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-form", shortCode],
    queryFn: async () => (await publicApi.getForm(shortCode!)).data as FormPayload,
    enabled: !!shortCode,
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: (formData: Record<string, unknown>) => {
      if (!data) throw new Error("No form");
      return publicApi.submitLead({
        qrCodeId: data.qrCode.id,
        visitorTypeId: data.qrCode.visitorTypeId,
        boothId: data.qrCode.boothId,
        formDefinitionId: data.form!.id,
        eventId: data.qrCode.eventId,
        formData,
      });
    },
    onSuccess: (res) => {
      setPlayToken(res?.data?.playToken ?? null);
      setSubmitted(true);
    },
  });

  // Prefill the dynamic form with a contact, then remount it so defaults apply.
  const applyContact = (contact: Contact, msg: { tone: "ok" | "warn"; text: string }) => {
    if (!data?.form) return;
    const base = data.form.fields.filter((f: any) => f.isActive !== false);
    setPrefillFields(applyContactToFields(base, contact));
    setPrefillNonce((n) => n + 1);
    setQuickMsg(msg);
  };

  // Path 2 — BNI auto-fetch by name, email OR phone.
  const lookupPhone = async () => {
    const q = phone.trim();
    if (q.length < 3) {
      setQuickMsg({ tone: "warn", text: "Enter your name, email or phone." });
      return;
    }
    setBusy("phone");
    try {
      const { data: res } = await publicApi.bniLookup(q);
      const m = res?.members?.[0];
      if (m) {
        applyContact(bniToContact(m), { tone: "ok", text: `Found you, ${m.name}! Please review and confirm below.` });
      } else {
        // Seed the phone only if they actually typed digits.
        const digits = q.replace(/\D/g, "");
        const seed = digits.length >= 6 ? { phone: q } : {};
        applyContact(seed, { tone: "warn", text: "No match found — please fill in your details below." });
      }
    } catch {
      setQuickMsg({ tone: "warn", text: "Lookup failed — please fill in your details below." });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <Loader2 className="animate-spin" />
          Loading form…
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
          <AlertTriangle className="mx-auto mb-3 text-amber-500" size={40} />
          <h1 className="text-lg font-semibold text-gray-900">QR code not found</h1>
          <p className="mt-1 text-sm text-gray-500">
            This QR code is invalid or no longer active. Please ask a staff member for help.
          </p>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
          <CheckCircle2 className="mx-auto mb-3 text-green-500" size={48} />
          <h1 className="text-xl font-bold text-gray-900">Thank you!</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your details have been submitted to <span className="font-medium">{data.event.name}</span>.
          </p>

          {playToken && (
            <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-5">
              <p className="text-sm font-semibold text-indigo-900">🎮 One more thing — play a quick game!</p>
              <p className="mt-1 text-xs text-indigo-700">
                Get your instant AI website score, or run the profitability calculator.
              </p>
              <Link
                to={`/play/${playToken}`}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <Gamepad2 size={16} /> Play now
              </Link>
            </div>
          )}

          <button
            onClick={() => {
              setSubmitted(false);
              setPlayToken(null);
            }}
            className="mt-6 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Submit another
          </button>
        </div>
      </Shell>
    );
  }

  if (!data.form || data.form.fields.length === 0) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
          <AlertTriangle className="mx-auto mb-3 text-amber-500" size={40} />
          <h1 className="text-lg font-semibold text-gray-900">Form not available</h1>
          <p className="mt-1 text-sm text-gray-500">
            No active lead form is configured for this event yet.
          </p>
        </div>
      </Shell>
    );
  }

  const activeFields = data.form.fields.filter((f: any) => f.isActive !== false);

  return (
    <Shell>
      <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
        {data.event.bannerImageUrl && (
          <img src={data.event.bannerImageUrl} alt="" className="h-32 w-full object-cover" />
        )}
        <div className="p-6 sm:p-8">
          <div className="mb-6 text-center">
            {data.event.logoUrl && (
              <img src={data.event.logoUrl} alt="" className="mx-auto mb-3 h-12 object-contain" />
            )}
            <h1 className="text-xl font-bold text-gray-900">{data.event.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {data.booth.name} · <span className="font-medium text-indigo-600">{data.visitorType.name}</span>
            </p>
          </div>

          {/* Quick-start: enter your phone to auto-fill from the BNI directory. */}
          <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <p className="mb-3 text-sm font-semibold text-indigo-900">BNI member? Auto-fill in seconds</p>
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3">
              <Search size={15} className="text-indigo-400" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupPhone()}
                placeholder="Name, email or phone"
                className="w-full bg-transparent py-2 text-sm focus:outline-none"
              />
              <button
                onClick={lookupPhone}
                disabled={busy !== null}
                className="shrink-0 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy === "phone" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              </button>
            </div>
            {quickMsg && (
              <p className={`mt-2 text-xs ${quickMsg.tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
                {quickMsg.text}
              </p>
            )}
          </div>

          {submitMutation.isError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Something went wrong submitting the form. Please try again.
            </div>
          )}

          <DynamicForm
            key={prefillNonce}
            fields={prefillFields ?? activeFields}
            submitting={submitMutation.isPending}
            onSubmit={(values) => submitMutation.mutate(values)}
          />

          <p className="mt-6 text-center text-xs text-gray-400">Powered by Exhibition Lead Capture</p>
        </div>
      </div>
    </Shell>
  );
}
