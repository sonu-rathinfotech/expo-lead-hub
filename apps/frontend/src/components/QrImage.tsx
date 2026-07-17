import { useEffect, useRef } from "react";
import QRCode from "qrcode";

// Renders `value` as a QR code onto a canvas and exposes PNG/SVG/print helpers.
export function QrImage({ value, size = 200 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
    }).catch(() => {
      /* ignore render errors */
    });
  }, [value, size]);

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-lg bg-white" />;
}

export async function downloadQrPng(value: string, filename: string) {
  const dataUrl = await QRCode.toDataURL(value, { width: 512, margin: 2 });
  triggerDownload(dataUrl, `${filename}.png`);
}

export async function downloadQrSvg(value: string, filename: string) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 2 });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  triggerDownload(url, `${filename}.svg`);
  URL.revokeObjectURL(url);
}

export async function printQr(value: string, title: string) {
  const dataUrl = await QRCode.toDataURL(value, { width: 512, margin: 2 });
  const win = window.open("", "_blank", "width=420,height=520");
  if (!win) return;
  win.document.write(`
    <html><head><title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; text-align: center; padding: 32px; }
      h2 { margin: 0 0 16px; font-size: 18px; }
      img { width: 320px; height: 320px; }
      p { color: #666; font-size: 12px; margin-top: 12px; word-break: break-all; }
    </style></head>
    <body>
      <h2>${title}</h2>
      <img src="${dataUrl}" />
      <p><strong>Scan the QR</strong>, or on a computer visit:</p>
      <p style="color:#4f46e5">${value}</p>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>`);
  win.document.close();
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
