'use client';
import { useRef, useState } from 'react';

export default function ExpenseForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string>('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [amountValue, setAmountValue] = useState('');
  const [localOcrHint, setLocalOcrHint] = useState('');
  const [autoFillFlash, setAutoFillFlash] = useState(false);

  const normalizeAmount = (rawAmount: string): string => {
    const cleaned = rawAmount.replace(/\s/g, '').replace(',', '.');
    return cleaned;
  };

  const extractAmountFromOcrText = (text: string): string | null => {
    const normalized = text
      .replace(/[Oo](?=\d)/g, '0')
      .replace(/\s+/g, ' ')
      .toUpperCase()
      .replace('ZAPtATY', 'ZAPLATY')
      .replace('ZAPŁATY', 'ZAPLATY');

    const amountRegex = /(?<!\d)(\d{1,4}(?:[ .]\d{3})*[,.]\d{2})(?!\d)/g;
    const keywords = ['SUMA', 'SUMA PLN', 'TOTAL', 'DO ZAPLATY', 'RAZEM', 'PLN'];
    const amounts = [...normalized.matchAll(amountRegex)].map((match) => {
      const raw = match[1];
      const start = match.index || 0;
      const value = Number(normalizeAmount(raw));
      return { raw, start, value };
    });

    if (amounts.length === 0) {
      return null;
    }

    const keywordPositions = keywords
      .map((word) => ({ word, pos: normalized.indexOf(word) }))
      .filter((item) => item.pos >= 0);

    let best: { raw: string; score: number } | null = null;
    for (const amount of amounts) {
      let score = 0;

      if (amount.value > 0 && amount.value <= 10000) {
        score += 2;
      }

      for (const key of keywordPositions) {
        const distance = Math.abs(amount.start - key.pos);
        if (distance <= 35) score += 5;
        else if (distance <= 80) score += 3;
      }

      if (!best || score > best.score) {
        best = { raw: amount.raw, score };
      }
    }

    if (best && best.score > 0) {
      return normalizeAmount(best.raw);
    }

    const reasonable = amounts.filter((item) => item.value > 0 && item.value <= 10000);
    if (reasonable.length > 0) {
      const last = reasonable[reasonable.length - 1];
      return normalizeAmount(last.raw);
    }

    return normalizeAmount(amounts[amounts.length - 1].raw);
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
        const contrasted = gray > 140 ? 255 : gray * 0.6;
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

  const runLocalOCR = async (file: File): Promise<string | null> => {
    const { recognize } = await import('tesseract.js');
    const preparedInput = await prepareImageForOCR(file);
    const result = await recognize(preparedInput, 'pol+eng');
    const text = result?.data?.text || '';
    console.log('OCR text preview:', text.slice(0, 500));
    return extractAmountFromOcrText(text);
  };

  const sendToPaperlessArchive = async (file: File, title: string): Promise<void> => {
    const archiveData = new FormData();
    archiveData.append('file', file);
    archiveData.append('title', title || 'Paragon');

    await fetch('/api/magic-fill', {
      method: 'POST',
      body: archiveData,
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setAnalyzing(true);
    setIsError(false);
    setLocalOcrHint('Analizuję paragon lokalnie...');
    const hideHintTimer = setTimeout(() => {
      setLocalOcrHint((current) => (current ? '' : current));
    }, 7000);

    try {
      const titleInput = formRef.current?.elements.namedItem('title') as HTMLInputElement | null;
      const titleValue = titleInput?.value?.trim() || 'Paragon';

      void sendToPaperlessArchive(selectedFile, titleValue).catch((error) => {
        console.error('Archiwizacja Paperless nieudana:', error);
      });

      const foundAmount = await runLocalOCR(selectedFile);
      if (foundAmount) {
        setAmountValue(foundAmount);
        setAutoFillFlash(true);
        setTimeout(() => setAutoFillFlash(false), 1200);
        setLocalOcrHint('');
      } else {
        setLocalOcrHint('Nie wykryto kwoty automatycznie. Wpisz ręcznie.');
      }
    } catch {
      setLocalOcrHint('');
    } finally {
      clearTimeout(hideHintTimer);
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    console.log('Rozpoczynam wysyłkę...');
    setLoading(true);
    setIsError(false);
    setMessage('⏳ Wysyłanie pliku na serwer...');

    try {
      const response = await fetch('/api/save-expense', {
        method: 'POST',
        body: formData,
      });

      const result = (await response.json().catch(() => ({
        success: false,
        error: 'Nieprawidlowa odpowiedz serwera',
      }))) as { success?: boolean; error?: string };

      console.log('Wynik:', result);

      if (result.success) {
        setMessage('✅ Sukces! Plik wysłany do Paperless.');
        setIsError(false);
        formRef.current?.reset();
        setAmountValue('');
      } else {
        setMessage('❌ Błąd serwera: ' + (result.error || `HTTP ${response.status}`));
        setIsError(true);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Nieznany błąd';
      setMessage('❌ Błąd krytyczny: ' + errorMessage);
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-5 space-y-4">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="block text-sm font-medium text-slate-700">Kwota</label>
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
          placeholder="np. 150.50"
          className={`w-full rounded border p-2 transition-colors duration-500 ${
            autoFillFlash ? 'border-emerald-500 bg-emerald-50' : ''
          }`}
          required
          value={amountValue}
          onChange={(event) => setAmountValue(event.target.value)}
        />
        {localOcrHint && <p className="mt-1 text-xs text-slate-500">{localOcrHint}</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Tytuł / Sklep</label>
        <input type="text" name="title" placeholder="np. Biedronka - Zakupy" className="w-full rounded border p-2" required />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Zdjęcie paragonu</label>
        <input
          type="file"
          name="file"
          accept="image/*,application/pdf"
          className="w-full rounded border p-2"
          required
          onChange={handleFileChange}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-green-600 p-3 font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Wysyłanie...' : 'Zapisz wydatek'}
      </button>
      
      {message && (
        <div
          className={`mt-4 rounded p-3 text-center font-medium ${
            isError ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-800'
          }`}
        >
          {message}
        </div>
      )}
    </form>
  );
}
