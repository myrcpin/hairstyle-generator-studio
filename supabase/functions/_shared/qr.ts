import QRCode from "npm:qrcode@1.5.4";

/** PNG bytes of a QR code for the given URL. */
export async function qrPng(url: string): Promise<Uint8Array> {
  const dataUrl: string = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 512, color: { dark: "#161513", light: "#ffffff" } });
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
