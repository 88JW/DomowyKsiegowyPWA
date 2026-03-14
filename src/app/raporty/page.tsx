'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type ReportResponse = {
  success: boolean;
  error?: string;
  period?: { start: string; end: string };
  summary?: { gross: string; net: string; vat: string };
  counts?: { fireflyTransactions: number; paperlessDocuments: number };
  paperlessLinks?: Array<{ id: number; title: string; created: string; url: string }>;
};

export default function RaportyPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ReportResponse | null>(null);

  const hasData = useMemo(() => report?.success && report.summary, [report]);

  const generateCurrentMonthReport = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/raporty/current-month', {
        method: 'GET',
        cache: 'no-store',
      });

      const data = (await res.json().catch(() => ({ success: false, error: 'Nieprawidlowa odpowiedz API' }))) as ReportResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setReport(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Nieznany blad';
      setError(message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-20">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-3 py-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Raporty JDG</h1>
            <p className="mt-1 text-slate-500">Miesieczne zestawienie kosztow firmowych (tag: Firma)</p>
          </div>
          <Link href="/" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Wroc do formularza
          </Link>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => void generateCurrentMonthReport()}
            disabled={loading}
            className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Generowanie...' : 'Generuj raport za biezacy miesiac'}
          </button>

          {error && (
            <p className="mt-4 rounded-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
          )}

          {hasData && report?.summary && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Suma Brutto</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{report.summary.gross} PLN</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Suma Netto</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{report.summary.net} PLN</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Suma VAT</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{report.summary.vat} PLN</p>
                </div>
              </div>

              <div className="text-sm text-slate-600">
                Okres: <strong>{report.period?.start}</strong> - <strong>{report.period?.end}</strong>
                <br />
                Firefly (Firma): <strong>{report.counts?.fireflyTransactions ?? 0}</strong> • Paperless (Firma):{' '}
                <strong>{report.counts?.paperlessDocuments ?? 0}</strong>
              </div>

              <div>
                <h2 className="text-lg font-semibold text-slate-900">Dokumenty Paperless (Firma)</h2>
                {report.paperlessLinks && report.paperlessLinks.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {report.paperlessLinks.map((doc) => (
                      <li key={doc.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          {doc.title}
                        </a>
                        <p className="text-xs text-slate-500">{new Date(doc.created).toLocaleString('pl-PL')}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Brak dokumentow z tagiem Firma w tym miesiacu.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
