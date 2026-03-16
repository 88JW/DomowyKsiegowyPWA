'use client';

import { useState } from 'react';

function currentDateValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function CompanyInvoiceQuickAdd() {
  const [isOpen, setIsOpen] = useState(false);
  const [date, setDate] = useState(currentDateValue());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const resetForm = () => {
    setDate(currentDateValue());
    setDescription('');
    setAmount('');
    setError('');
  };

  const closeModal = () => {
    setIsOpen(false);
    setLoading(false);
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const normalizedAmount = amount.trim() ? Number(amount.replace(/\s/g, '').replace(',', '.')) : null;

      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description,
          amount: normalizedAmount,
        }),
      });

      const data = (await response.json().catch(() => ({ success: false, error: 'Nieprawidlowa odpowiedz API' }))) as {
        success: boolean;
        error?: string;
        pending?: boolean;
        message?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.pending) {
        setSuccessMessage(
          data.message ||
            'Wpis przyjety przez Paperless. Trwa przetwarzanie i pojawi sie za chwile po odswiezeniu.',
        );
      } else {
        setSuccessMessage('Zakup firmowy zapisany w Paperless. Status domyslny: Brak faktury.');
      }
      resetForm();
      closeModal();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Nieznany blad zapisu');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Faktury firmowe</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Szybka zajawka zakupu</h2>
            <p className="mt-2 text-sm text-slate-600">
              Dodaj od razu zakup na firme, nawet jesli jeszcze nie masz pobranego PDF-a ani skanu.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
              setError('');
            }}
            className="inline-flex rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            Dodaj zakup firmowy
          </button>
        </div>

        {successMessage && (
          <p className="mt-4 rounded-lg bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-700">{successMessage}</p>
        )}
      </section>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Nowy wpis</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">Dodaj zakup firmowy</h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
              >
                Zamknij
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block text-sm font-medium text-slate-700">
                Data zakupu
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-amber-500"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Co kupiono / sprzedawca
                <input
                  type="text"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Np. Kabel HDMI - Allegro"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-amber-500"
                  required
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Kwota (opcjonalnie)
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0,00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-amber-500"
                />
              </label>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Po zapisaniu wpis trafi do Paperless i dostanie status <strong>Brak faktury</strong>.
              </div>

              {error && (
                <p className="rounded-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-700">{error}</p>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Zapisywanie...' : 'Zapisz zajawke'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}