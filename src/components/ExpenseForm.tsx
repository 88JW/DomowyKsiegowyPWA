'use client';

import Cropper, { type Area } from 'react-easy-crop';
import { useEffect, useMemo, useRef, useState } from 'react';

import { buildCompanyPaperlessTitle, normalizeIssueDate, normalizeNip } from '@/lib/company-documents';

type LocalOcrResult = {
  amount: string | null;
  issueDate: string | null;
  nip: string | null;
  storeName: string | null;
};

type RecentDocumentItem = {
  id: string;
  title: string;
  status: 'Wysylanie' | 'Wyslany do Paperless' | 'Blad wysylki';
  timestamp: string;
};

const STORE_PATTERNS = [
  { name: 'Biedronka', keywords: ['BIEDRONKA'] },
  { name: 'Lidl', keywords: ['LIDL'] },
  { name: 'Zabka', keywords: ['ZABKA', 'ZABKA POLSKA'] },
  { name: 'Orlen', keywords: ['ORLEN', 'STOP CAFE'] },
  { name: 'Auchan', keywords: ['AUCHAN'] },
  { name: 'Carrefour', keywords: ['CARREFOUR'] },
  { name: 'Kaufland', keywords: ['KAUFLAND'] },
  { name: 'Rossmann', keywords: ['ROSSMANN'] },
];

const normalizeSearchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();

const createImageElement = async (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('Nie udalo sie wczytac obrazu do kadrowania')));
    image.src = src;
  });

const createCroppedFile = async (src: string, cropArea: Area, originalFileName: string) => {
  const image = await createImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropArea.width));
  canvas.height = Math.max(1, Math.round(cropArea.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Brak kontekstu canvas do kadrowania');
  }

  ctx.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    cropArea.width,
    cropArea.height,
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) {
    throw new Error('Nie udalo sie zapisac przycietego obrazu');
  }

  const safeName = originalFileName.replace(/\.[^.]+$/, '') || 'faktura';
  return new File([blob], `${safeName}-crop.jpg`, { type: 'image/jpeg' });
};

function formatTimestamp(timestamp: string) {
  try {
    return new Date(timestamp).toLocaleString('pl-PL');
  } catch {
    return timestamp;
  }
}

export default function ExpenseForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [amountValue, setAmountValue] = useState('');
  const [issueDateValue, setIssueDateValue] = useState('');
  const [nipValue, setNipValue] = useState('');
  const [storeNameValue, setStoreNameValue] = useState('');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [localOcrHint, setLocalOcrHint] = useState('');

  const [cropSource, setCropSource] = useState<string | null>(null);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [cropFileName, setCropFileName] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.25);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const [recentDocuments, setRecentDocuments] = useState<RecentDocumentItem[]>([]);

  useEffect(() => {
    return () => {
      if (cropSource) {
        URL.revokeObjectURL(cropSource);
      }
    };
  }, [cropSource]);

  const paperlessTitle = useMemo(
    () =>
      buildCompanyPaperlessTitle({
        issueDate: issueDateValue,
        storeName: storeNameValue,
        nip: nipValue,
        amount: amountValue,
      }),
    [amountValue, issueDateValue, nipValue, storeNameValue],
  );

  const detectStoreFromOcrText = (text: string) => {
    const normalized = normalizeSearchText(text);

    for (const store of STORE_PATTERNS) {
      const found = store.keywords.some((keyword) => normalized.includes(normalizeSearchText(keyword)));
      if (found) {
        return store.name;
      }
    }

    return null;
  };

  const extractAmountFromText = (text: string) => {
    const normalized = normalizeSearchText(text)
      .replace(/[O](?=\d)/g, '0')
      .replace('ZAPtATY', 'ZAPLATY');

    const amountRegex = /(?<!\d)(\d{1,4}(?:[ .]\d{3})*[,.]\d{2})(?!\d)/g;
    const matches = [...normalized.matchAll(amountRegex)].map((match) => match[1]);

    if (matches.length === 0) {
      return null;
    }

    const candidate = matches[matches.length - 1] || '';
    const parsed = Number(candidate.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed.toFixed(2);
  };

  const extractIssueDateFromText = (text: string) => {
    const normalized = normalizeSearchText(text);
    const datePattern = /(\d{2})[./-](\d{2})[./-](\d{4})|(\d{4})[./-](\d{2})[./-](\d{2})/g;
    const matches = [...normalized.matchAll(datePattern)];

    if (matches.length === 0) {
      return null;
    }

    const chosen = matches[0];
    const dateText = chosen[0] || '';
    return normalizeIssueDate(dateText);
  };

  const extractNipFromText = (text: string) => {
    const normalized = normalizeSearchText(text);
    const prefixed = normalized.match(/NIP\s*[:]?\s*([0-9\-\s]{10,20})/i);

    if (prefixed?.[1]) {
      const nip = normalizeNip(prefixed[1]);
      if (nip) {
        return nip;
      }
    }

    const allDigitMatches = normalized.match(/\d{10}/g);
    if (!allDigitMatches || allDigitMatches.length === 0) {
      return null;
    }

    for (const candidate of allDigitMatches) {
      const nip = normalizeNip(candidate);
      if (nip) {
        return nip;
      }
    }

    return null;
  };

  const prepareImageForOCR = async (file: File): Promise<Blob | File> => {
    if (!file.type.startsWith('image/')) {
      return file;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const maxWidth = 1800;
      const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
      const width = Math.max(1, Math.floor(bitmap.width * scale));
      const height = Math.max(1, Math.floor(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return file;
      }

      ctx.drawImage(bitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.min(255, Math.max(0, 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
        const contrasted = gray > 142 ? 255 : gray * 0.6;
        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
      }

      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      return blob || file;
    } catch {
      return file;
    }
  };

  const runLocalOCR = async (file: File): Promise<LocalOcrResult> => {
    const { recognize } = await import('tesseract.js');
    const preparedInput = await prepareImageForOCR(file);
    const result = await recognize(preparedInput, 'pol+eng');
    const text = result?.data?.text || '';

    return {
      amount: extractAmountFromText(text),
      issueDate: extractIssueDateFromText(text),
      nip: extractNipFromText(text),
      storeName: detectStoreFromOcrText(text),
    };
  };

  const resetCropState = () => {
    if (cropSource) {
      URL.revokeObjectURL(cropSource);
    }

    setCropSource(null);
    setPendingCropFile(null);
    setCropFileName('');
    setCroppedAreaPixels(null);
    setShowCropper(false);
  };

  const analyzeCompanyDocument = async (file: File) => {
    setSelectedFile(file);
    setSelectedFileName(file.name);
    setAnalyzing(true);
    setIsError(false);
    setLocalOcrHint('Analiza OCR: kwota, data i NIP...');

    try {
      const ocr = await runLocalOCR(file);
      if (ocr.amount) {
        setAmountValue(ocr.amount);
      }
      if (ocr.issueDate) {
        setIssueDateValue(ocr.issueDate);
      }
      if (ocr.nip) {
        setNipValue(ocr.nip);
      }
      if (ocr.storeName) {
        setStoreNameValue(ocr.storeName);
      }

      const hints = [];
      if (ocr.amount) hints.push(`Kwota: ${ocr.amount}`);
      if (ocr.issueDate) hints.push(`Data: ${ocr.issueDate}`);
      if (ocr.nip) hints.push(`NIP: ${ocr.nip}`);
      if (ocr.storeName) hints.push(`Sklep: ${ocr.storeName}`);

      setLocalOcrHint(
        hints.length > 0
          ? hints.join(' • ')
          : 'OCR nie znalazl wszystkich danych. Mozesz dopisac je recznie.',
      );
    } catch (error) {
      console.error('OCR lokalny nieudany:', error);
      setLocalOcrHint('Nie udalo sie odczytac dokumentu lokalnie. Uzupelnij dane recznie.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setMessage('');
    setIsError(false);

    if (file.type.startsWith('image/')) {
      if (cropSource) {
        URL.revokeObjectURL(cropSource);
      }

      setCrop({ x: 0, y: 0 });
      setZoom(1.25);
      setCroppedAreaPixels(null);
      setCropFileName(file.name);
      setPendingCropFile(file);
      setCropSource(URL.createObjectURL(file));
      setShowCropper(true);
      return;
    }

    await analyzeCompanyDocument(file);
  };

  const handleCropConfirm = async () => {
    if (!cropSource || !croppedAreaPixels) {
      return;
    }

    try {
      const croppedFile = await createCroppedFile(cropSource, croppedAreaPixels, cropFileName);
      resetCropState();
      await analyzeCompanyDocument(croppedFile);
    } catch (error) {
      console.error('Kadrowanie nieudane:', error);
      setLocalOcrHint('Nie udalo sie przyciac dokumentu. Sprobuj ponownie.');
      resetCropState();
    }
  };

  const handleSkipCrop = async () => {
    if (!pendingCropFile) {
      return;
    }

    const originalFile = pendingCropFile;
    resetCropState();
    await analyzeCompanyDocument(originalFile);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setIsError(true);
      setMessage('❌ Wybierz fakture/paragon przed zapisem.');
      return;
    }

    if (!amountValue.trim()) {
      setIsError(true);
      setMessage('❌ Brakuje kwoty kosztu.');
      return;
    }

    const pendingItem: RecentDocumentItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: paperlessTitle,
      status: 'Wysylanie',
      timestamp: new Date().toISOString(),
    };

    setRecentDocuments((prev) => [pendingItem, ...prev].slice(0, 8));

    const formData = new FormData();
    formData.append('amount', amountValue);
    formData.append('title', paperlessTitle);
    formData.append('issueDate', issueDateValue);
    formData.append('storeName', storeNameValue);
    formData.append('nip', nipValue);
    formData.append('file', selectedFile);

    setLoading(true);
    setIsError(false);
    setMessage('⏳ Wysylanie dokumentu firmowego...');

    try {
      const response = await fetch('/api/save-expense', {
        method: 'POST',
        body: formData,
      });

      const result = (await response.json().catch(() => ({
        success: false,
        error: 'Nieprawidlowa odpowiedz serwera',
      }))) as { success?: boolean; error?: string };

      if (result.success) {
        setMessage('✅ Dokument firmowy zapisany i wyslany do Paperless.');
        setRecentDocuments((prev) =>
          prev.map((item) =>
            item.id === pendingItem.id ? { ...item, status: 'Wyslany do Paperless' } : item,
          ),
        );

        formRef.current?.reset();
        setAmountValue('');
        setIssueDateValue('');
        setNipValue('');
        setStoreNameValue('');
        setSelectedFile(null);
        setSelectedFileName('');
        setLocalOcrHint('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        setIsError(true);
        setMessage(`❌ Blad serwera: ${result.error || `HTTP ${response.status}`}`);
        setRecentDocuments((prev) =>
          prev.map((item) =>
            item.id === pendingItem.id ? { ...item, status: 'Blad wysylki' } : item,
          ),
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Nieznany blad';
      setIsError(true);
      setMessage(`❌ Blad krytyczny: ${errorMessage}`);
      setRecentDocuments((prev) =>
        prev.map((item) =>
          item.id === pendingItem.id ? { ...item, status: 'Blad wysylki' } : item,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {showCropper && cropSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-sm font-semibold text-slate-900">Kadrowanie dokumentu</p>
              <p className="mt-1 text-sm text-slate-500">
                Wytnij dokladnie obszar faktury/paragonu przed uruchomieniem OCR.
              </p>
            </div>

            <div className="relative h-80 bg-slate-950">
              <Cropper
                image={cropSource}
                crop={crop}
                zoom={zoom}
                aspect={4 / 5}
                showGrid
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
              />
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                  <span>Powiekszenie</span>
                  <span>{zoom.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="w-full accent-emerald-600"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetCropState();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={() => void handleSkipCrop()}
                  className="rounded-2xl border border-emerald-200 px-4 py-3 font-medium text-emerald-700 transition hover:bg-emerald-50"
                >
                  Pomin kadrowanie
                </button>
                <button
                  type="button"
                  onClick={() => void handleCropConfirm()}
                  className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-700"
                >
                  Uzyj kadru
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <label className="block text-sm font-medium text-slate-700">Kwota brutto</label>
            {analyzing && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <span className="h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                OCR lokalny...
              </span>
            )}
          </div>
          <input
            type="number"
            step="0.01"
            name="amount"
            placeholder="np. 149.99"
            className="w-full rounded border p-2"
            required
            value={amountValue}
            onChange={(event) => setAmountValue(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Data wystawienia</label>
            <input
              type="date"
              name="issueDate"
              className="w-full rounded border p-2"
              value={issueDateValue}
              onChange={(event) => setIssueDateValue(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">NIP</label>
            <input
              type="text"
              name="nip"
              placeholder="10 cyfr"
              className="w-full rounded border p-2"
              value={nipValue}
              onChange={(event) => setNipValue(event.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Sklep / Kontrahent</label>
          <input
            type="text"
            name="storeName"
            placeholder="np. Orlen, Biedronka"
            className="w-full rounded border p-2"
            value={storeNameValue}
            onChange={(event) => setStoreNameValue(event.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Tytul Paperless (auto)</label>
          <input type="text" readOnly value={paperlessTitle} className="w-full rounded border bg-slate-50 p-2 text-slate-700" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Faktura / Paragon</label>
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept="image/*,application/pdf"
            className="w-full rounded border p-2"
            required
            onChange={(event) => void handleFileChange(event)}
          />
          {selectedFileName && (
            <p className="mt-1 text-xs text-slate-500">Wybrany plik do wysylki: {selectedFileName}</p>
          )}
          {localOcrHint && <p className="mt-1 text-xs text-slate-500">{localOcrHint}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-green-600 p-3 font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Wysylanie...' : 'Zapisz koszt firmowy'}
        </button>

        {message && (
          <div className={`mt-4 rounded p-3 text-center font-medium ${isError ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-800'}`}>
            {message}
          </div>
        )}
      </form>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Ostatnie dokumenty firmowe</h3>
        {recentDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Brak dokumentow w tej sesji.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentDocuments.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800">{item.title}</p>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      item.status === 'Wyslany do Paperless'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.status === 'Blad wysylki'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.status}
                  </span>
                  <span className="text-slate-500">{formatTimestamp(item.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
