'use server'

export async function saveExpense(formData: FormData) {
  try {
    const paperlessUrl = process.env.PAPERLESS_API_URL;
    const paperlessToken = process.env.PAPERLESS_API_TOKEN;
    const fireflyUrl = process.env.FIREFLY_API_URL;
    const fireflyToken = process.env.FIREFLY_API_TOKEN;
    const sourceAccountName = 'Mia Software';

    if (!paperlessUrl || !paperlessToken || !fireflyUrl || !fireflyToken) {
      throw new Error('Brak konfiguracji API w zmiennych srodowiskowych');
    }

    const amount = formData.get('amount') as string;
    const title = formData.get('title') as string;
    // Backward compatibility for stale PWA bundles: support both `file` and old `receipt`.
    const file = (formData.get('file') || formData.get('receipt')) as File;

    console.log(`Próba zapisu: ${title} na kwotę ${amount}`);
    console.log('Wielkość pliku:', file?.size);

    if (!amount || !title) {
      throw new Error('Brakuje wymaganych danych formularza (amount/title)');
    }

    if (!file || file.size <= 0) {
      throw new Error('Nie wybrano pliku do wyslania');
    }

    // Pre-check: upewnij sie, ze konto zrodlowe istnieje w Firefly.
    const accountRes = await fetch(`${fireflyUrl}/accounts?type=asset&limit=200`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fireflyToken}`,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!accountRes.ok) {
      const accountErr = await accountRes.text().catch(() => 'Brak tresci bledu');
      throw new Error(`Nie mozna zweryfikowac konta zrodlowego: ${accountRes.status} (${accountErr})`);
    }

    const accountJson = await accountRes.json().catch(() => null) as
      | { data?: Array<{ attributes?: { name?: string } }> }
      | null;
    const hasSourceAccount = !!accountJson?.data?.some(
      (item) => item?.attributes?.name === sourceAccountName,
    );

    if (!hasSourceAccount) {
      throw new Error('Konto źródłowe nie istnieje');
    }

    // 1. Wysyłka do Paperless
    if (file && file.size > 0) {
      const pData = new FormData();
      pData.append('document', file);
      pData.append('title', `${new Date().toISOString().split('T')[0]} - ${title}`);

      const pRes = await fetch(`${paperlessUrl}/documents/post_document/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${paperlessToken}`,
          'Accept': 'application/json',
        },
        body: pData,
      });
      
      if (!pRes.ok) {
        const paperlessErr = await pRes.text().catch(() => 'Brak tresci bledu');
        throw new Error(`Paperless zwrócił błąd: ${pRes.status} (${paperlessErr})`);
      }
      console.log("Paperless OK");
    }

    // 2. Wysyłka do Firefly
    const fRes = await fetch(`${fireflyUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fireflyToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        error_if_duplicate_hash: false,
        transactions: [{
          type: 'withdrawal',
          description: title,
          amount: amount,
          date: new Date().toISOString(),
          source_name: sourceAccountName,
          destination_name: title,
        }]
      }),
    });

    if (!fRes.ok) {
      const errorText = await fRes.text();
      console.error("Błąd Firefly:", errorText);
      throw new Error(`Firefly zwrócił błąd: ${fRes.status}`);
    }

    console.log("Firefly OK");
    return { success: true };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd serwera';
    console.error('Błąd krytyczny akcji:', message);
    return { success: false, error: message };
  }
}

// Legacy action name kept for older cached clients.
export async function submitExpense(formData: FormData) {
  return saveExpense(formData);
}
