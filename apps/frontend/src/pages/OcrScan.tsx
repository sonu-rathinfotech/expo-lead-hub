import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Camera, ScanLine, Loader2, CheckCircle2, RotateCcw, Gamepad2, Search } from "lucide-react";
import toast from "react-hot-toast";
import { api, publicApi } from "../lib/api-client";
import { downscale } from "../lib/ocr";
import { useAuthStore } from "../stores/auth.store";
import { DynamicForm, type FormFieldDef } from "../components/DynamicForm";
import { useSearchParams, useNavigate } from "react-router-dom";

interface ParsedData {
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  designation?: string;
}

// Map OCR-parsed business-card data onto the dynamic form's field keys.
function injectOcr(fields: FormFieldDef[], parsed: ParsedData): FormFieldDef[] {
  const fullName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ");
  return fields.map((f) => {
    const k = f.fieldKey.toLowerCase();
    let v: string | undefined;
    if (/company|organi/.test(k)) v = parsed.companyName;
    else if (/contact|person|full.?name|^name$/.test(k)) v = fullName || undefined;
    else if (/email/.test(k)) v = parsed.email;
    else if (/mobile|phone/.test(k)) v = parsed.phone;
    else if (/website|url|web/.test(k)) v = parsed.website;
    else if (/designation|title|role/.test(k)) v = parsed.designation;
    else if (/address/.test(k)) v = parsed.address;
    return v ? { ...f, defaultValue: v } : f;
  });
}

// Prefill form fields from a matched BNI member (same key-matching as OCR).
function injectBni(fields: FormFieldDef[], m: any): FormFieldDef[] {
  return fields.map((f) => {
    const k = f.fieldKey.toLowerCase();
    let v: string | undefined;
    if (/company|organi/.test(k)) v = m.company;
    else if (/chapter/.test(k)) v = m.chapter;
    else if (/region/.test(k)) v = m.region;
    else if (/contact|person|full.?name|^name$/.test(k)) v = m.name;
    else if (/email/.test(k)) v = m.email;
    else if (/mobile|phone/.test(k)) v = m.phone;
    else if (/website|url|web/.test(k)) v = m.website;
    return v ? { ...f, defaultValue: v } : f;
  });
}

// Basic contact fields used for manual entry when an event's form has none.
const DEFAULT_MANUAL_FIELDS: FormFieldDef[] = [
  { id: "m_name", fieldKey: "contact_person", fieldType: "TEXT", label: "Name", isRequired: true },
  { id: "m_company", fieldKey: "company_name", fieldType: "TEXT", label: "Company", isRequired: false },
  { id: "m_email", fieldKey: "email", fieldType: "EMAIL", label: "Email", isRequired: false },
  { id: "m_phone", fieldKey: "mobile_number", fieldType: "PHONE", label: "Mobile", isRequired: false },
  { id: "m_designation", fieldKey: "designation", fieldType: "TEXT", label: "Designation", isRequired: false },
];

// Extra fields appended to every capture form.
const CATEGORY_FIELD: FormFieldDef = {
  id: "m_category",
  fieldKey: "category",
  fieldType: "TEXT",
  label: "Category",
  isRequired: false,
  placeholder: "e.g. IT, Finance, Real Estate",
} as FormFieldDef;
const CHAPTER_FIELD: FormFieldDef = {
  id: "m_chapter",
  fieldKey: "bni_chapter",
  fieldType: "TEXT",
  label: "BNI Chapter",
  isRequired: false,
} as FormFieldDef;
const NOTES_FIELD: FormFieldDef = {
  id: "m_notes",
  fieldKey: "notes",
  fieldType: "TEXTAREA",
  label: "Notes",
  isRequired: false,
  placeholder: "Notes about this lead (optional)",
} as FormFieldDef;

export function OcrScanPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const startManual = params.get("manual") === "1";
  const [eventId, setEventId] = useState("");
  const [boothId, setBoothId] = useState("");
  const [visitorTypeId, setVisitorTypeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [scan, setScan] = useState<{ rawText: string; confidence: number; parsed: ParsedData } | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [playToken, setPlayToken] = useState<string | null>(null);
  const [manual, setManual] = useState(startManual); // staff typing the lead by hand (no scan)
  // BNI quick-lookup (by name / email / mobile) to prefill the form.
  const [bniQuery, setBniQuery] = useState("");
  const [bniBusy, setBniBusy] = useState(false);
  const [bniMsg, setBniMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [bniMatch, setBniMatch] = useState<any | null>(null);
  const [bniResults, setBniResults] = useState<any[]>([]);
  const [bniNonce, setBniNonce] = useState(0);

  const { data: setup, error: setupError, isLoading: setupLoading } = useQuery({
    queryKey: ["ocr-setup"],
    queryFn: async () => (await api.ocr.setup()).data,
  });
  const events: { id: string; name: string; status?: string }[] = setup?.events ?? [];
  const activeEvent = events.find((e) => e.status === "ACTIVE") ?? events[0];
  const booths = setup?.booths ?? setup?.event?.booths ?? [];
  const visitorTypes = setup?.visitorTypes ?? setup?.event?.visitorTypes ?? [];
  const form = setup?.form ?? setup?.event?.formDefinitions?.[0];
  const activeFields: FormFieldDef[] = (setup?.fields ?? form?.fields ?? []).filter(
    (f: any) => f.isActive !== false,
  );

  // Default to the ACTIVE event; booth + visitor type auto-select below. The
  // pickers are hidden — staff just capture cards for the active event.
  useEffect(() => {
    if (!eventId && activeEvent) setEventId(activeEvent.id);
  }, [activeEvent, eventId]);
  useEffect(() => {
    if (eventId && !boothId && booths.length) setBoothId(booths[0].id);
  }, [eventId, booths, boothId]);
  useEffect(() => {
    if (eventId && !visitorTypeId && visitorTypes.length) setVisitorTypeId(visitorTypes[0].id);
  }, [eventId, visitorTypes, visitorTypeId]);

  const ready = eventId && boothId && visitorTypeId;

  const onFileChange = (f: File | null) => {
    setFile(f);
    setScan(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : "");
  };

  // OCR runs in the browser (Tesseract.js) — no server round-trip, works on the
  // free tier, and the phone does the heavy lifting.
  const runScan = async () => {
    if (!file) return;
    setScanning(true);
    try {
      // Downscale locally (smaller upload), then read with Gemini vision on the server.
      const dataUrl = await downscale(file);
      const res = await api.ocr.smartScan(dataUrl);
      const a = res.data?.parsed ?? {};
      const parsed: ParsedData = {
        companyName: a.companyName || undefined,
        firstName: a.contactPerson || undefined, // injectOcr builds full name from firstName
        email: a.email || undefined,
        phone: a.mobileNumber || undefined,
        website: a.website || undefined,
        designation: a.designation || undefined,
        address: a.address || undefined,
      };
      const hasAny = Object.values(parsed).some(Boolean);
      setScan({ rawText: res.data?.rawText ?? "", confidence: hasAny ? 1 : 0, parsed });
      setScanKey((k) => k + 1);
      if (hasAny) toast.success("Card read — review the details below");
      else toast("Couldn't read much — fill the form manually.", { icon: "✏️" });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Couldn't read the card. Try a clearer, well-lit photo.");
    } finally {
      setScanning(false);
    }
  };

  const submitMutation = useMutation({
    mutationFn: (formData: Record<string, unknown>) =>
      api.ocr.submit({
        eventId,
        boothId,
        visitorTypeId,
        formDefinitionId: form?.id,
        ocrRawText: scan?.rawText ?? "",
        ocrConfidence: scan?.confidence ?? 0,
        formData,
        submittedBy: user!.id,
        source: manual ? "MANUAL" : "OCR_SCAN",
      }),
    onSuccess: (res: any) => {
      setPlayToken(res?.data?.playToken ?? null);
      setDone(true);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Submit failed"),
  });

  const reset = () => {
    onFileChange(null);
    setScan(null);
    setDone(false);
    setPlayToken(null);
    setManual(false);
    setBniQuery("");
    setBniMatch(null);
    setBniResults([]);
    setBniMsg(null);
  };

  // Look up BNI members by name / email / mobile — show matches as suggestions.
  const lookupBni = async () => {
    const q = bniQuery.trim();
    if (q.length < 2) {
      setBniMsg({ tone: "warn", text: "Enter a name, email or mobile number." });
      return;
    }
    setBniBusy(true);
    setBniResults([]);
    try {
      const { data } = await publicApi.bniLookup(q);
      const members: any[] = data?.members ?? [];
      if (members.length === 1) {
        pickBni(members[0]);
      } else if (members.length > 1) {
        setBniResults(members);
        setBniMsg({ tone: "ok", text: `${members.length} matches — pick the right one below.` });
      } else {
        setBniMsg({ tone: "warn", text: "No match — please type the details in below." });
      }
    } catch {
      setBniMsg({ tone: "warn", text: "Lookup failed — please type the details in below." });
    } finally {
      setBniBusy(false);
    }
  };

  // Live typeahead — show name suggestions as the mobile/name is typed.
  useEffect(() => {
    const q = bniQuery.trim();
    if (q.length < 3) {
      setBniResults([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setBniBusy(true);
      try {
        const { data } = await publicApi.bniLookup(q);
        if (!cancelled) {
          setBniResults(data?.members ?? []);
          setBniMsg(null);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setBniBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [bniQuery]);

  // Apply a chosen member: prefill the form (name, company, chapter, etc.).
  const pickBni = (m: any) => {
    setBniMatch(m);
    setBniResults([]);
    setBniNonce((k) => k + 1); // remount the form with the prefilled values
    setManual(true); // reveal the form even without a scan
    setBniMsg({ tone: "ok", text: `Selected ${m.name}${m.company ? ` · ${m.company}` : ""} — details filled in below.` });
  };

  const bniSearchBox = (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
      <p className="mb-2 text-sm font-semibold text-indigo-900">BNI member? Search to auto-fill</p>
      <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3">
        <Search size={15} className="text-indigo-400" />
        <input
          value={bniQuery}
          onChange={(e) => setBniQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookupBni()}
          placeholder="Type mobile number…"
          className="w-full bg-transparent py-2 text-sm focus:outline-none"
        />
        <button
          onClick={lookupBni}
          disabled={bniBusy}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {bniBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
        </button>
      </div>
      {bniMsg && (
        <p className={`mt-2 text-xs ${bniMsg.tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}>{bniMsg.text}</p>
      )}
      {/* Name suggestions — pick the right member */}
      {bniResults.length > 0 && (
        <div className="mt-2 divide-y divide-indigo-100 overflow-hidden rounded-lg border border-indigo-200 bg-white">
          {bniResults.map((m) => (
            <button
              key={m.id ?? `${m.name}-${m.phone}`}
              onClick={() => pickBni(m)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
            >
              <span>
                <span className="font-medium text-gray-900">{m.name}</span>
                {m.company && <span className="text-gray-500"> · {m.company}</span>}
                {m.chapter && <span className="block text-xs text-gray-400">{m.chapter}</span>}
              </span>
              {m.phone && <span className="shrink-0 text-xs text-gray-400">{m.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // The lead form. Category / BNI Chapter / Notes are appended, then BNI + OCR
  // values are injected across the whole set (so Chapter gets prefilled too).
  const renderLeadForm = () => {
    const base: FormFieldDef[] = activeFields.length ? activeFields : form ? DEFAULT_MANUAL_FIELDS : [];
    if (base.length === 0) {
      return <p className="py-10 text-center text-sm text-amber-600">This event has no form configured.</p>;
    }
    const extras = [CATEGORY_FIELD, CHAPTER_FIELD, NOTES_FIELD].filter((x) => !base.some((f) => f.fieldKey === x.fieldKey));
    let formFields = [...base, ...extras];
    if (bniMatch) formFields = injectBni(formFields, bniMatch);
    if (scan) formFields = injectOcr(formFields, scan.parsed);
    return (
      <DynamicForm
        key={`${scan ? scanKey : "manual"}-${bniNonce}`}
        fields={formFields}
        submitting={submitMutation.isPending}
        onSubmit={(values) => {
          // Save the lead, then go straight into the game on THIS screen (single
          // booth iPad). "Back to home" on the game returns for the next capture.
          submitMutation.mutate(values, {
            onSuccess: (res: any) => {
              const token = res?.data?.playToken;
              if (token) navigate(`/play/${token}`);
            },
          });
        }}
      />
    );
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto mb-3 text-green-500" size={48} />
        <h2 className="text-xl font-bold text-gray-900">Lead captured</h2>
        <p className="mt-2 text-sm text-gray-600">Saved. Let them play a quick game right here.</p>

        {playToken && (
          <button
            onClick={() => navigate(`/play/${playToken}`)}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Gamepad2 size={16} /> Play now
          </button>
        )}

        <div className="mt-6">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw size={16} /> Capture another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{startManual ? "Manual Entry" : "Capture Lead"}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {activeEvent?.name ? (
            <>
              <span className="font-medium text-indigo-600">{activeEvent.name}</span> ·{" "}
            </>
          ) : null}
          {startManual
            ? "Fill in the visitor's details, then save the lead."
            : "Scan a business card to auto-fill, or enter the details manually — then save the lead."}
        </p>
      </div>

      {setupError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {(setupError as any)?.response?.data?.message ?? "Could not load the capture form. Refresh and try again."}
        </p>
      ) : !ready ? (
        <p className="text-sm text-gray-400">
          {setupLoading
            ? "Setting up the active event…"
            : events.length === 0
              ? "No active event. Create one in Events."
              : booths.length === 0 || visitorTypes.length === 0
                ? "This event needs a booth and a visitor type before you can capture leads."
                : "Setting up the active event…"}
        </p>
      ) : startManual ? (
        // Manual Form — BNI search + just the form, no card-scan UI.
        <div className="mx-auto max-w-2xl space-y-4">
          {bniSearchBox}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="mb-3 font-semibold text-gray-900">Enter lead details</h3>
            {renderLeadForm()}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {bniSearchBox}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Capture */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="mb-3 font-semibold text-gray-900">1 · Capture card</h3>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-10 text-gray-500 hover:border-indigo-400 hover:bg-indigo-50/40">
              <Camera size={28} />
              <span className="text-sm font-medium">Tap to take a photo or upload</span>
              <span className="text-xs text-gray-400">JPEG / PNG / WebP · max 5MB</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="mt-3 text-center">
              <button
                onClick={() => setManual(true)}
                className={`text-sm font-medium ${manual ? "text-gray-400" : "text-indigo-600 hover:underline"}`}
                disabled={manual}
              >
                {manual ? "Manual entry — fill the form on the right →" : "or enter details manually (no card)"}
              </button>
            </div>

            {preview && (
              <div className="mt-4">
                <img src={preview} alt="card preview" className="max-h-56 w-full rounded-lg object-contain" />
                <button
                  onClick={runScan}
                  disabled={scanning}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {scanning ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                  {scanning ? "Reading card…" : "Scan card"}
                </button>
                {scanning && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full w-1/3 rounded-full bg-indigo-500" style={{ animation: "indeterminate 1.4s ease-in-out infinite" }} />
                    <style>{`@keyframes indeterminate { 0%{margin-left:-33%} 100%{margin-left:100%} }`}</style>
                  </div>
                )}
              </div>
            )}

            {scan && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">
                    OCR confidence: <b className="text-gray-800">{Math.round(scan.confidence * 100)}%</b>
                  </span>
                  <button onClick={() => setShowRaw((v) => !v)} className="text-xs font-medium text-indigo-600 hover:underline">
                    {showRaw ? "Hide" : "Show"} raw text
                  </button>
                </div>
                {showRaw && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-gray-600">
                    {scan.rawText || "(no text detected)"}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Review + submit */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="mb-3 font-semibold text-gray-900">2 · Review &amp; save</h3>
            {!scan && !manual ? (
              <p className="py-10 text-center text-sm text-gray-400">Scan a card, or choose “enter details manually”.</p>
            ) : (
              renderLeadForm()
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

