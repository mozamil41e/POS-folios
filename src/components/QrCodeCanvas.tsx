import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeCanvasProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeCanvas({ value, size = 148, className = '' }: QrCodeCanvasProps) {
  const [svgMarkup, setSvgMarkup] = useState<string>('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setSvgMarkup('');
      return;
    }

    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setSvgMarkup(url);
      })
      .catch(() => {
        if (active) setSvgMarkup('');
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!svgMarkup) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center bg-slate-100 text-slate-400 text-xs rounded-lg border border-slate-200 ${className}`}
      >
        QR
      </div>
    );
  }

  return (
    <img
      src={svgMarkup}
      alt="ZATCA TLV QR Code"
      width={size}
      height={size}
      className={`rounded-md border border-slate-200 bg-white p-1 ${className}`}
    />
  );
}
