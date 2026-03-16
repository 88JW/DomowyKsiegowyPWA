'use client';

import { useEffect, useState } from 'react';

type CompanyInvoiceStatus = 'BRAK' | 'PDF' | 'SKAN';

type CompanyInvoice = {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  documentStatus: CompanyInvoiceStatus;
  entryType: 'ZAJAWKA' | 'FAKTURA';
  userEmail: string;
};

type DashboardResponse = {
  success: boolean;
  error?: string;
  month?: string;
  summary?: {
    total: number;
    missing: number;
    pdf: number;
    scan: number;
    amountTotal: number;
  };
  invoices?: CompanyInvoice[];
};

const STATUS_OPTIONS: Array<{ value: CompanyInvoiceStatus; label: string }> = [
  { value: 'BRAK', label: 'Brak faktury' },
  { value: 'PDF', label: 'Dostarczono (PDF)' },
  { value: 'SKAN', label: 'Dostarczono (Skan)' },
];

const STATUS_BADGE_CLASS: Record<CompanyInvoiceStatus, string> = {
  BRAK: 'bg-rose-100 text-rose-700 border-rose-200',
  PDF: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  SKAN: 'bg-sky-100 text-sky-700 border-sky-200',
};

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatAmount(amount: number | null) {
  if (amount === null) {
    return '—';
  }

  return `${amount.toFixed(2)} PLN`;
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split('-');
  const parsed = new Date(Number(year), Number(monthNumber) - 1, 1);
  return parsed.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
}

function summarize(invoices: CompanyInvoice[]) {
  return {
    total: invoices.length,
    missing: invoices.filter((invoice) => invoice.documentStatus === 'BRAK').length,
    pdf: invoices.filter((invoice) => invoice.documentStatus === 'PDF').length,
    scan: invoices.filter((invoice) => invoice.documentStatus === 'SKAN').length,
    amountTotal: Number(invoices.reduce((sum, invoice) => sum + (invoice.amount || 0), 0).toFixed(2)),
  };
}

export default function CompanyInvoicesDashboard() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CompanyInvoice | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editStatus, setEditStatus] = useState<CompanyInvoiceStatus>('BRAK');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/invoices?month=${selectedMonth}`, {
          cache: 'no-store',
        });
        const result = (await response.json().catch(() => ({ success: false, error: 'Nieprawidlowa odpowiedz API' }))) as DashboardResponse;

        if (!response.ok || !result.success) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }

        if (isMounted) {
          setData(result);
        }
      } catch (loadError: unknown) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Nieznany blad pobierania');
          setData(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [selectedMonth]);

  const handleStatusChange = async (invoiceId: string, status: CompanyInvoiceStatus) => {
    const previousData = data;
    if (!previousData?.invoices) {
      return;
    }

    const updatedInvoices = previousData.invoices.map((invoice) =>
      invoice.id === invoiceId ? { ...invoice, documentStatus: status } : invoice,
    );

    const updatedSummary = summarize(updatedInvoices);

    setPendingId(invoiceId);
    setError('');
    setData({ ...previousData, invoices: updatedInvoices, summary: updatedSummary });

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      const result = (await response.json().catch(() => ({ success: false, error: 'Nieprawidlowa odpowiedz API' }))) as {
        success: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
    } catch (updateError: unknown) {
      setData(previousData);
      setError(updateError instanceof Error ? updateError.message : 'Nieznany blad aktualizacji');
    } finally {
      setPendingId(null);
    }
  };

  const openEdit = (invoice: CompanyInvoice) => {
    setEditTarget(invoice);
    setEditDate(invoice.date);
    setEditDescription(invoice.description);
    setEditAmount(invoice.amount === null ? '' : invoice.amount.toFixed(2));
    setEditStatus(invoice.documentStatus);
    setError('');
  };

  const closeEdit = () => {
    if (!editSaving) {
      setEditTarget(null);
    }
  };

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editTarget || !data?.invoices) {
      return;
    }

    const normalizedAmount = editAmount.trim() ? Number(editAmount.replace(/\s/g, '').replace(',', '.')) : null;

    setEditSaving(true);
    setError('');

    try {
      const response = await fetch(`/api/invoices/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editDate,
          description: editDescription,
          amount: normalizedAmount,
          status: editStatus,
        }),
      });

      const result = (await response.json().catch(() => ({ success: false, error: 'Nieprawidlowa odpowiedz API' }))) as {
        success: boolean;
        error?: string;
        invoice?: CompanyInvoice;
      };

      if (!response.ok || !result.success || !result.invoice) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      const nextInvoices = data.invoices.map((invoice) =>
        invoice.id === result.invoice?.id ? result.invoice : invoice,
      );

      setData({
        ...data,
        invoices: nextInvoices,
        summary: summarize(nextInvoices),
      });
      setEditTarget(null);
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Nieznany blad edycji');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Modul faktur</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Faktury firmowe i zestawienia</h2>
          <p className="mt-2 text-sm text-slate-500">
            Monitoruj zakupy firmowe i szybko oznaczaj, czy dokument zostal juz dostarczony.
          </p>
        </div>

        <label className="text-sm font-medium text-slate-700">
          Miesiac rozliczeniowy
          <input
            type="month"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="mt-1 block rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500"
          />
        </label>
      </div>

      {loading && <p className="mt-6 text-sm text-slate-500">Ladowanie zestawienia faktur...</p>}

      {error && (
        <p className="mt-6 rounded-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
      )}

      {!loading && !error && data?.summary && (
        <>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Podsumowanie</p>
              <p className="mt-2 text-lg font-bold text-slate-900">
                Wydatki firmowe: {data.summary.total} | Brakuje faktur: {data.summary.missing}
              </p>
              <p className="mt-2 text-sm text-slate-500">Okres: {monthLabel(selectedMonth)}</p>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs uppercase tracking-wide text-emerald-700">PDF</p>
              <p className="mt-2 text-2xl font-bold text-emerald-700">{data.summary.pdf}</p>
              <p className="mt-2 text-sm text-slate-600">Skan: {data.summary.scan}</p>
            </div>

            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs uppercase tracking-wide text-rose-700">Braki</p>
              <p className="mt-2 text-2xl font-bold text-rose-700">{data.summary.missing}</p>
              <p className="mt-2 text-sm text-slate-600">Suma: {data.summary.amountTotal.toFixed(2)} PLN</p>
            </div>
          </div>

          {data.invoices && data.invoices.length > 0 ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
              <div className="hidden grid-cols-[120px_minmax(0,1fr)_140px_220px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
                <span>Data</span>
                <span>Zakup</span>
                <span>Kwota</span>
                <span>Status</span>
              </div>

              <ul className="divide-y divide-slate-200">
                {data.invoices.map((invoice) => (
                  <li key={invoice.id} className="grid gap-4 px-4 py-4 md:grid-cols-[120px_minmax(0,1fr)_140px_220px] md:items-center">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 md:hidden">Data</p>
                      <p className="text-sm font-medium text-slate-700">{invoice.date}</p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 md:hidden">Zakup</p>
                      <p className="text-sm font-semibold text-slate-900">{invoice.description}</p>
                      <p className="mt-1 text-xs text-slate-500">Uzytkownik: {invoice.userEmail}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Typ wpisu: {invoice.entryType === 'ZAJAWKA' ? 'Zajawka (oczekuje na fakture)' : 'Wpis faktury'}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 md:hidden">Kwota</p>
                      <p className="text-sm font-medium text-slate-700">{formatAmount(invoice.amount)}</p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[invoice.documentStatus]}`}>
                        {STATUS_OPTIONS.find((option) => option.value === invoice.documentStatus)?.label}
                      </span>

                      <select
                        value={invoice.documentStatus}
                        onChange={(event) => void handleStatusChange(invoice.id, event.target.value as CompanyInvoiceStatus)}
                        disabled={pendingId === invoice.id}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => openEdit(invoice)}
                        disabled={pendingId === invoice.id}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Edytuj
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              Brak zapisanych zakupow firmowych dla miesiaca {monthLabel(selectedMonth)}.
            </div>
          )}
        </>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Edycja wpisu</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">Aktualizuj zajawke / fakture</h3>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                disabled={editSaving}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Zamknij
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void handleEditSubmit(event)}>
              <label className="block text-sm font-medium text-slate-700">
                Data zakupu
                <input
                  type="date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-sky-500"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Opis zakupu
                <input
                  type="text"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-sky-500"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Kwota
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(event) => setEditAmount(event.target.value)}
                  placeholder="0,00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-sky-500"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Status dokumentu
                <select
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value as CompanyInvoiceStatus)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Jesli ustawisz status na PDF lub SKAN, wpis automatycznie zostanie oznaczony jako normalny wpis faktury.
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={editSaving}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {editSaving ? 'Zapisywanie...' : 'Zapisz zmiany'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}