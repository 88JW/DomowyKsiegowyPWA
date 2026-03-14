import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const paperlessUrl = process.env.PAPERLESS_API_URL;
    const paperlessToken = process.env.PAPERLESS_API_TOKEN;
    const fireflyUrl = process.env.FIREFLY_API_URL;
    const fireflyToken = process.env.FIREFLY_API_TOKEN;
    const sourceAccountName = 'Mia Software';

    if (!paperlessUrl || !paperlessToken || !fireflyUrl || !fireflyToken) {
      return NextResponse.json(
        { success: false, error: 'Brak konfiguracji API w zmiennych srodowiskowych' },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const amount = formData.get('amount') as string;
    const title = formData.get('title') as string;
    const file = (formData.get('file') || formData.get('receipt')) as File;

    console.log(`Proba zapisu: ${title} na kwote ${amount}`);
    console.log('Wielkosc pliku:', file?.size);

    if (!amount || !title) {
      return NextResponse.json(
        { success: false, error: 'Brakuje wymaganych danych formularza (amount/title)' },
        { status: 400 },
      );
    }

    if (!file || file.size <= 0) {
      return NextResponse.json(
        { success: false, error: 'Nie wybrano pliku do wyslania' },
        { status: 400 },
      );
    }

    const accountRes = await fetch(`${fireflyUrl}/accounts?type=asset&limit=200`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${fireflyToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!accountRes.ok) {
      const accountErr = await accountRes.text().catch(() => 'Brak tresci bledu');
      return NextResponse.json(
        {
          success: false,
          error: `Nie mozna zweryfikowac konta zrodlowego: ${accountRes.status} (${accountErr})`,
        },
        { status: 502 },
      );
    }

    const accountJson = (await accountRes.json().catch(() => null)) as
      | { data?: Array<{ attributes?: { name?: string } }> }
      | null;

    const hasSourceAccount = !!accountJson?.data?.some(
      (item) => item?.attributes?.name === sourceAccountName,
    );

    if (!hasSourceAccount) {
      return NextResponse.json(
        { success: false, error: 'Konto źródłowe nie istnieje' },
        { status: 400 },
      );
    }

    const pData = new FormData();
    pData.append('document', file);
    pData.append('title', `${new Date().toISOString().split('T')[0]} - ${title}`);

    const pRes = await fetch(`${paperlessUrl}/documents/post_document/`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${paperlessToken}`,
        Accept: 'application/json',
      },
      body: pData,
    });

    if (!pRes.ok) {
      const paperlessErr = await pRes.text().catch(() => 'Brak tresci bledu');
      return NextResponse.json(
        { success: false, error: `Paperless zwrocil blad: ${pRes.status} (${paperlessErr})` },
        { status: 502 },
      );
    }

    const fRes = await fetch(`${fireflyUrl}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fireflyToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        error_if_duplicate_hash: false,
        transactions: [
          {
            type: 'withdrawal',
            description: title,
            amount,
            date: new Date().toISOString(),
            source_name: sourceAccountName,
            destination_name: title,
          },
        ],
      }),
    });

    if (!fRes.ok) {
      const errorText = await fRes.text().catch(() => 'Brak tresci bledu');
      return NextResponse.json(
        { success: false, error: `Firefly zwrocil blad: ${fRes.status} (${errorText})` },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad serwera';
    console.error('Blad krytyczny API:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
