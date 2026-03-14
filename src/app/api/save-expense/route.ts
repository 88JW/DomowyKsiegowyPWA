import { NextResponse } from 'next/server';

import { buildCompanyPaperlessTitle } from '@/lib/company-documents';
import { getFireflyConfig } from '@/lib/firefly';
import { applyCompanyTagsToDocument, waitForTaskDocumentId } from '@/lib/paperless-ocr';

export async function POST(request: Request) {
  try {
    const paperlessUrl = process.env.PAPERLESS_API_URL;
    const paperlessToken = process.env.PAPERLESS_API_TOKEN;
    const { fireflyUrl, fireflyToken, sourceAccountName } = getFireflyConfig();

    if (!paperlessUrl || !paperlessToken) {
      return NextResponse.json(
        { success: false, error: 'Brak konfiguracji API w zmiennych srodowiskowych' },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const amount = formData.get('amount') as string;
    const title = (formData.get('title') as string) || '';
    const issueDate = (formData.get('issueDate') as string) || '';
    const storeName = (formData.get('storeName') as string) || title;
    const nip = (formData.get('nip') as string) || '';
    const file = (formData.get('file') || formData.get('receipt')) as File;
    const companyPaperlessTitle = buildCompanyPaperlessTitle({
      issueDate,
      storeName,
      nip,
      amount,
    });

    console.log(`Proba zapisu: ${companyPaperlessTitle} na kwote ${amount}`);
    console.log('Wielkosc pliku:', file?.size);

    if (!amount) {
      return NextResponse.json(
        { success: false, error: 'Brakuje wymaganych danych formularza (amount)' },
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
    pData.append('title', companyPaperlessTitle);

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

    const taskId = (await pRes.text().catch(() => '')).replace(/"/g, '').trim();
    if (taskId) {
      const documentId = await waitForTaskDocumentId(taskId, 8);
      if (documentId) {
        await applyCompanyTagsToDocument(documentId).catch((error) => {
          console.error('Nie udalo sie przypisac tagow firmowych:', error);
        });
      }
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
            description: companyPaperlessTitle,
            amount,
            date: new Date().toISOString(),
            source_name: sourceAccountName,
            destination_name: storeName || nip || 'Koszt firmowy',
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
