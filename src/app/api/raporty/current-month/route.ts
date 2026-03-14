import { NextResponse } from 'next/server';

import { COMPANY_FIREFLY_TAGS } from '@/lib/company-documents';
import { getFireflyConfig } from '@/lib/firefly';
import { getPaperlessConfig } from '@/lib/paperless-ocr';

type FireflySplit = {
  amount?: string;
  tags?: string[];
  notes?: string;
};

type FireflyTransaction = {
  attributes?: {
    transactions?: FireflySplit[];
  };
};

type PaperlessDocument = {
  id?: number;
  title?: string;
  created?: string;
};

function currentMonthPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    monthPrefix,
  };
}

function parseMoney(raw: string | undefined) {
  if (!raw) return null;
  const value = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseNoteValue(notes: string | undefined, label: string) {
  if (!notes) return null;
  const pattern = new RegExp(`(?:^|\\n)${label}\\s*:\\s*([0-9]+(?:[.,][0-9]{2})?)`, 'im');
  const match = notes.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return parseMoney(match[1]);
}

function hasCompanyTag(tags: string[] | undefined) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return false;
  }

  const normalized = tags.map((tag) => String(tag).toLowerCase());
  return COMPANY_FIREFLY_TAGS.some((tag) => normalized.includes(tag.toLowerCase()));
}

function paperlessDocumentUrl(paperlessApiUrl: string, documentId: number) {
  const appBase = paperlessApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  return `${appBase}/documents/${documentId}/details/`;
}

async function fetchFireflyCompanySplits(start: string, end: string) {
  const { fireflyUrl, fireflyToken } = getFireflyConfig();
  const allSplits: FireflySplit[] = [];

  for (let page = 1; page <= 12; page += 1) {
    const url = `${fireflyUrl}/transactions?type=withdrawal&start=${start}&end=${end}&limit=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${fireflyToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Brak tresci bledu');
      throw new Error(`Firefly API blad: ${res.status} (${err})`);
    }

    const json = (await res.json().catch(() => null)) as
      | {
          data?: FireflyTransaction[];
          meta?: { pagination?: { current_page?: number; total_pages?: number } };
        }
      | null;

    const items = Array.isArray(json?.data) ? json.data : [];
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const splits = item?.attributes?.transactions;
      if (!Array.isArray(splits)) {
        continue;
      }

      for (const split of splits) {
        if (hasCompanyTag(split.tags)) {
          allSplits.push(split);
        }
      }
    }

    const totalPages = json?.meta?.pagination?.total_pages;
    if (typeof totalPages === 'number' && page >= totalPages) {
      break;
    }
  }

  return allSplits;
}

async function fetchPaperlessCompanyDocuments(monthPrefix: string) {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();
  const links: Array<{ id: number; title: string; created: string; url: string }> = [];

  for (let page = 1; page <= 12; page += 1) {
    const res = await fetch(
      `${paperlessUrl}/documents/?page_size=100&page=${page}&ordering=-created&tags__name__iexact=Firma`,
      {
        headers: {
          Authorization: `Token ${paperlessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => 'Brak tresci bledu');
      throw new Error(`Paperless API blad: ${res.status} (${err})`);
    }

    const json = (await res.json().catch(() => null)) as
      | { results?: PaperlessDocument[]; next?: string | null }
      | null;

    const results = Array.isArray(json?.results) ? json.results : [];
    if (results.length === 0) {
      break;
    }

    for (const item of results) {
      if (typeof item.id !== 'number') {
        continue;
      }

      const created = item.created || '';
      if (!created.startsWith(monthPrefix)) {
        continue;
      }

      links.push({
        id: item.id,
        title: item.title || `Dokument ${item.id}`,
        created,
        url: paperlessDocumentUrl(paperlessUrl, item.id),
      });
    }

    if (!json?.next) {
      break;
    }
  }

  return links;
}

export async function GET() {
  try {
    const period = currentMonthPeriod();
    const splits = await fetchFireflyCompanySplits(period.start, period.end);

    let grossSum = 0;
    let netSum = 0;
    let vatSum = 0;

    for (const split of splits) {
      const gross = Math.abs(parseMoney(split.amount) || 0);
      const net = parseNoteValue(split.notes, 'Netto');
      const vat = parseNoteValue(split.notes, 'VAT');

      grossSum += gross;
      if (net !== null && vat !== null) {
        netSum += Math.abs(net);
        vatSum += Math.abs(vat);
      } else {
        netSum += gross;
      }
    }

    const paperlessLinks = await fetchPaperlessCompanyDocuments(period.monthPrefix);

    return NextResponse.json({
      success: true,
      period: {
        start: period.start,
        end: period.end,
      },
      summary: {
        gross: grossSum.toFixed(2),
        net: netSum.toFixed(2),
        vat: vatSum.toFixed(2),
      },
      counts: {
        fireflyTransactions: splits.length,
        paperlessDocuments: paperlessLinks.length,
      },
      paperlessLinks,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad raportu';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
