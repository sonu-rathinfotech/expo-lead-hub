import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QrCode as QrIcon, Download, Printer, Trash2, Loader2, Plus, Copy, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api-client";
import { appUrl } from "../lib/app-url";
import { QrImage, downloadQrPng, downloadQrSvg, printQr } from "../components/QrImage";
import { formatDate } from "../components/badges";

interface Booth {
  id: string;
  name: string;
}
interface VisitorType {
  id: string;
  name: string;
  color?: string | null;
}
interface QrRow {
  id: string;
  shortCode: string;
  label?: string | null;
  scanCount: number;
  isActive: boolean;
  createdAt: string;
  visitorType?: { id: string; name: string; color?: string | null } | null;
}

// The public visitor URL encoded into each QR code.
const publicUrl = (shortCode: string) => appUrl(`/v/${shortCode}`);

export function QrCodesPage() {
  const qc = useQueryClient();
  const [eventId, setEventId] = useState("");
  const [boothId, setBoothId] = useState("");
  const [selectedVts, setSelectedVts] = useState<string[]>([]);
  const [label, setLabel] = useState("");

  const { data: eventsData } = useQuery({
    queryKey: ["events-filter"],
    queryFn: async () => (await api.events.list({ take: 100 })).data,
  });
  const events: { id: string; name: string }[] = eventsData?.events ?? [];

  const { data: eventDetail } = useQuery({
    queryKey: ["event-detail", eventId],
    queryFn: async () => (await api.events.get(eventId)).data,
    enabled: !!eventId,
  });
  const booths: Booth[] = eventDetail?.event?.booths ?? [];
  const visitorTypes: VisitorType[] = eventDetail?.event?.visitorTypes ?? [];

  // Default the Event and Booth dropdowns to the first available option.
  useEffect(() => {
    if (!eventId && events.length) setEventId(events[0]!.id);
  }, [events, eventId]);
  useEffect(() => {
    if (eventId && !boothId && booths.length) setBoothId(booths[0]!.id);
  }, [eventId, booths, boothId]);

  const { data: qrData, isLoading: qrLoading } = useQuery({
    queryKey: ["qr-codes", eventId, boothId],
    queryFn: async () => (await api.qr.list(eventId, boothId)).data,
    enabled: !!eventId && !!boothId,
  });
  const qrCodes: QrRow[] = qrData?.qrCodes ?? [];

  const generateMutation = useMutation({
    mutationFn: () => api.qr.generate(eventId, boothId, { visitorTypeIds: selectedVts, label: label || undefined }),
    onSuccess: (res: any) => {
      toast.success(res.data?.message ?? "QR codes generated");
      setSelectedVts([]);
      setLabel("");
      qc.invalidateQueries({ queryKey: ["qr-codes", eventId, boothId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Generation failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (qrId: string) => api.qr.delete(eventId, boothId, qrId),
    onSuccess: () => {
      toast.success("QR code deleted");
      qc.invalidateQueries({ queryKey: ["qr-codes", eventId, boothId] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const toggleVt = (id: string) =>
    setSelectedVts((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">QR Codes</h2>
        <p className="mt-1 text-sm text-gray-500">Generate scannable QR codes per booth &amp; visitor type</p>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Event</label>
          <select
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setBoothId("");
              setSelectedVts([]);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Select an event…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Booth</label>
          <select
            value={boothId}
            onChange={(e) => setBoothId(e.target.value)}
            disabled={!eventId}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50"
          >
            <option value="">Select a booth…</option>
            {booths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {eventId && boothId && (
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium text-gray-700">Visitor types</label>
            <div className="flex flex-wrap gap-2">
              {visitorTypes.map((vt) => {
                const active = selectedVts.includes(vt.id);
                return (
                  <button
                    key={vt.id}
                    type="button"
                    onClick={() => toggleVt(vt.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: vt.color ?? "#94a3b8" }} />
                    {vt.name}
                  </button>
                );
              })}
              {visitorTypes.length === 0 && (
                <p className="text-sm text-gray-400">This event has no visitor types.</p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-sm font-medium text-gray-700">Label (optional)</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Hall A entrance"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={selectedVts.length === 0 || generateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {generateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Generate ({selectedVts.length})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing QR codes */}
      {eventId && boothId && (
        <div>
          {qrLoading ? (
            <p className="text-gray-500">Loading QR codes…</p>
          ) : qrCodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
              <QrIcon size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">No QR codes for this booth yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {qrCodes.map((qr) => {
                const url = publicUrl(qr.shortCode);
                const name = qr.label || qr.visitorType?.name || qr.shortCode;
                // Friendly download filename from the visitor type / label.
                const fileName =
                  name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || qr.shortCode;
                return (
                  <div key={qr.id} className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <QrImage value={url} size={180} />
                    <div className="mt-3 w-full text-center">
                      <p className="truncate font-semibold text-gray-900" title={name}>
                        {name}
                      </p>
                      {qr.visitorType && (
                        <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-gray-500">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: qr.visitorType.color ?? "#94a3b8" }} />
                          {qr.visitorType.name}
                        </span>
                      )}
                      {/* Full link — clickable to open on desktop, or copy to share */}
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title={url}
                        className="mt-1 flex items-center justify-center gap-1 truncate font-mono text-xs text-indigo-600 hover:underline"
                      >
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
                      </a>
                      <p className="mt-1 text-xs text-gray-400">
                        {qr.scanCount} scans · {formatDate(qr.createdAt)}
                      </p>
                    </div>
                    <div className="mt-4 flex w-full items-center justify-center gap-1">
                      <IconBtn
                        title="Copy link (to fill the form on a desktop)"
                        onClick={() => {
                          navigator.clipboard.writeText(url).then(
                            () => toast.success("Link copied"),
                            () => toast.error("Couldn't copy"),
                          );
                        }}
                      >
                        <Copy size={16} />
                      </IconBtn>
                      <IconBtn title="Download PNG" onClick={() => downloadQrPng(url, fileName)}>
                        <Download size={16} />
                      </IconBtn>
                      <IconBtn title="Download SVG" onClick={() => downloadQrSvg(url, fileName)}>
                        <span className="text-xs font-bold">SVG</span>
                      </IconBtn>
                      <IconBtn title="Print" onClick={() => printQr(url, name)}>
                        <Printer size={16} />
                      </IconBtn>
                      <IconBtn
                        title="Delete"
                        onClick={() => {
                          if (confirm("Delete this QR code?")) deleteMutation.mutate(qr.id);
                        }}
                        danger
                      >
                        <Trash2 size={16} />
                      </IconBtn>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-lg border border-gray-200 px-2 text-gray-600 hover:bg-gray-50 ${
        danger ? "hover:border-red-200 hover:bg-red-50 hover:text-red-600" : ""
      }`}
    >
      {children}
    </button>
  );
}
