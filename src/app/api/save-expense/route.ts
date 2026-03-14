import { NextResponse } from 'next/server';

import { buildCompanyPaperlessTitle, COMPANY_FIREFLY_TAGS, FUEL_TAG } from '@/lib/company-documents';
import { getFireflyConfig } from '@/lib/firefly';
import { applyCompanyTagsToDocument, waitForTaskDocumentId } from '@/lib/paperless-ocr';

function normalizeMoneyValue(raw: string) {
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildFireflyNotes(input: {
  grossAmount: string;
  vatRate: string;
  netAmount: string;
  vatAmount: string;
  sellerNip: string;
  isFuelExpense: boolean;
}) {
  const lines = [
    `Brutto: ${input.grossAmount}`,
    `Stawka VAT: ${input.vatRate}`,
    `Netto: ${input.netAmount}`,
    `VAT: ${input.vatAmount}`,
  ];

  if (input.sellerNip) {
    lines.push(`NIP sprzedawcy: ${input.sellerNip}`);
  }

  lines.push(`Kategoria: ${input.isFuelExpense ? 'Paliwo/Auto' : 'Koszt firmowy'}`);
  return lines.join('\n');
}

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
    const sellerNip = ((formData.get('sellerNip') || formData.get('nip')) as string) || '';
    const vatRate = ((formData.get('vatRate') as string) || '').toUpperCase() || 'ZW';
    const netAmount = (formData.get('netAmount') as string) || amount;
    const vatAmount = (formData.get('vatAmount') as string) || '0.00';
    const isFuelExpense = ((formData.get('isFuelExpense') as string) || '').toLowerCase() === 'true';
    const file = (formData.get('file') || formData.get('receipt')) as File;
    const companyPaperlessTitle = buildCompanyPaperlessTitle({
      issueDate,
      storeName,
      nip: sellerNip,
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

    const normalizedAmount = normalizeMoneyValue(amount);
    if (normalizedAmount === null || normalizedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Nieprawidlowa kwota brutto.' },
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
    const paperlessExtraTags = isFuelExpense ? [FUEL_TAG] : [];
    if (taskId) {
      const documentId = await waitForTaskDocumentId(taskId, 8);
      if (documentId) {
        await applyCompanyTagsToDocument(documentId, paperlessExtraTags).catch((error) => {
          console.error('Nie udalo sie przypisac tagow firmowych:', error);
        });
      }
    }

    const fireflyTags = isFuelExpense
      ? [...COMPANY_FIREFLY_TAGS, FUEL_TAG]
      : [...COMPANY_FIREFLY_TAGS];
    const fireflyNotes = buildFireflyNotes({
      grossAmount: normalizedAmount.toFixed(2),
      vatRate,
      netAmount,
      vatAmount,
      sellerNip,
      isFuelExpense,
    });
    const transactionDate = issueDate || new Date().toISOString().slice(0, 10);

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
            amount: normalizedAmount.toFixed(2),
            date: transactionDate,
            source_name: sourceAccountName,
            destination_name: storeName || sellerNip || 'Koszt firmowy',
            notes: fireflyNotes,
            tags: fireflyTags,
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
