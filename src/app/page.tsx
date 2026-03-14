export const dynamic = 'force-dynamic';

import ExpenseForm from '@/components/ExpenseForm';

export default async function Home() {
  let isPaperlessOnline = false;
  let isFireflyOnline = false;

  // Safe status checks: page should still render even when APIs/env are unavailable.
  try {
    const paperlessUrl = process.env.PAPERLESS_API_URL;
    const paperlessToken = process.env.PAPERLESS_API_TOKEN;
    const fireflyUrl = process.env.FIREFLY_API_URL;
    const fireflyToken = process.env.FIREFLY_API_TOKEN;

    if (paperlessUrl && paperlessToken) {
      const pRes = await fetch(`${paperlessUrl}/status/`, {
        headers: { Authorization: `Token ${paperlessToken}` },
        next: { revalidate: 0 },
      }).catch(() => null);
      isPaperlessOnline = !!pRes?.ok;
    }

    if (fireflyUrl && fireflyToken) {
      const fRes = await fetch(`${fireflyUrl}/about`, {
        headers: { Authorization: `Bearer ${fireflyToken}` },
        next: { revalidate: 0 },
      }).catch(() => null);
      isFireflyOnline = !!fRes?.ok;
    }
  } catch (e) {
    console.error('Blad sprawdzania statusu API:', e);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-20">
      <div className="mx-auto max-w-md space-y-6">
        <header className="py-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Księgowy PWA</h1>
          <p className="mt-2 text-slate-500">Zarządzaj wydatkami domowymi</p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex gap-2">
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isPaperlessOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              Paperless: {isPaperlessOnline ? 'OK' : 'Błąd'}
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isFireflyOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              Firefly: {isFireflyOnline ? 'OK' : 'Błąd'}
            </div>
          </div>

          <ExpenseForm />
        </div>
      </div>
    </main>
  );
}
