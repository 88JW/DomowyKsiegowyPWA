import { applyCompanyTagsToDocument, getPaperlessConfig } from '@/lib/paperless-ocr';

export const COMPANY_INVOICE_STATUSES = ['BRAK', 'PDF', 'SKAN'] as const;
const PWA_INVOICE_BASE_TAG = 'PWA-WPIS-FAKTURY';
const PWA_INVOICE_TAG_TEASER = 'PWA-ZAJAWKA';
const PWA_INVOICE_TAG_FINAL = 'PWA-FAKTURA';

const TITLE_PREFIX = 'PWAINV';

export type CompanyInvoiceStatus = (typeof COMPANY_INVOICE_STATUSES)[number];

export type CompanyInvoiceEntryType = 'ZAJAWKA' | 'FAKTURA';

export type CompanyInvoice = {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  documentStatus: CompanyInvoiceStatus;
  entryType: CompanyInvoiceEntryType;
  userEmail: string;
  createdAt: string;
  updatedAt: string;
};

type CreateCompanyInvoiceInput = {
  date: string;
  description: string;
  amount?: number | null;
  userEmail: string;
};

type CreateCompanyInvoiceResult =
  | {
      pending: false;
      invoice: CompanyInvoice;
    }
  | {
      pending: true;
      invoice: null;
      taskId: string;
    };

function isCompanyInvoiceStatus(value: unknown): value is CompanyInvoiceStatus {
  return typeof value === 'string' && COMPANY_INVOICE_STATUSES.includes(value as CompanyInvoiceStatus);
}

function normalizeIsoDate(rawDate: string) {
  const trimmed = rawDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Data zakupu musi miec format RRRR-MM-DD');
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Nieprawidlowa data zakupu');
  }

  return trimmed;
}

function normalizeAmount(amount?: number | null) {
  if (amount === null || typeof amount === 'undefined') {
    return null;
  }

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Kwota musi byc liczba dodatnia lub pusta');
  }

  return Number(amount.toFixed(2));
}

function normalizeDescription(description: string) {
  const normalized = description.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3) {
    throw new Error('Opis zakupu musi miec co najmniej 3 znaki');
  }
  if (normalized.length > 180) {
    throw new Error('Opis zakupu jest za dlugi');
  }
  return normalized;
}

function normalizeUserEmail(userEmail: string) {
  const normalized = userEmail.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Brak tozsamosci SSO uzytkownika');
  }
  return normalized;
}

function normalizeMonth(month: string) {
  const normalized = month.trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error('Parametr month musi miec format RRRR-MM');
  }

  return normalized;
}

function sanitizeTitlePart(value: string) {
  return value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function encodeTitleValue(value: string) {
  return encodeURIComponent(value);
}

function decodeTitleValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function serializeAmount(amount: number | null) {
  return amount === null ? '' : amount.toFixed(2);
}

function parseAmount(rawAmount: string) {
  if (!rawAmount) {
    return null;
  }

  const parsed = Number(rawAmount.replace(',', '.'));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function buildPaperlessInvoiceTitle(input: {
  userEmail: string;
  date: string;
  description: string;
  amount: number | null;
  status: CompanyInvoiceStatus;
}) {
  return [
    TITLE_PREFIX,
    encodeTitleValue(normalizeUserEmail(input.userEmail)),
    normalizeIsoDate(input.date),
    input.status,
    serializeAmount(input.amount),
    encodeTitleValue(sanitizeTitlePart(input.description)),
  ].join('|');
}

function parsePaperlessInvoiceTitle(title: string) {
  const parts = title.split('|');
  if (parts.length < 6 || parts[0] !== TITLE_PREFIX) {
    return null;
  }

  const status = parts[3];
  if (!isCompanyInvoiceStatus(status)) {
    return null;
  }

  const userEmail = normalizeUserEmail(decodeTitleValue(parts[1] || ''));
  const date = normalizeIsoDate(parts[2] || '');
  const amount = parseAmount(parts[4] || '');
  const description = normalizeDescription(decodeTitleValue(parts.slice(5).join('|')));

  return {
    userEmail,
    date,
    status,
    amount,
    description,
  } satisfies {
    userEmail: string;
    date: string;
    status: CompanyInvoiceStatus;
    amount: number | null;
    description: string;
  };
}

function statusTag(status: CompanyInvoiceStatus) {
  return `PWA-${status}`;
}

function typeTagForStatus(status: CompanyInvoiceStatus): CompanyInvoiceEntryType {
  return status === 'BRAK' ? 'ZAJAWKA' : 'FAKTURA';
}

function tagsForStatus(status: CompanyInvoiceStatus) {
  if (status === 'BRAK') {
    return [PWA_INVOICE_BASE_TAG, statusTag(status), PWA_INVOICE_TAG_TEASER];
  }

  return [PWA_INVOICE_BASE_TAG, statusTag(status), PWA_INVOICE_TAG_FINAL];
}

function buildEntryDocumentContent(input: {
  userEmail: string;
  date: string;
  description: string;
  amount: number | null;
  status: CompanyInvoiceStatus;
}) {
  const amountValue = input.amount === null ? 'brak' : input.amount.toFixed(2);
  return [
    'PWA wpis firmowy',
    `Uzytkownik: ${input.userEmail}`,
    `Data zakupu: ${input.date}`,
    `Opis: ${input.description}`,
    `Kwota: ${amountValue}`,
    `Status dokumentu: ${input.status}`,
    '',
    'Wpis utworzony automatycznie z aplikacji PWA.',
  ].join('\n');
}

type PaperlessDocument = {
  id?: number;
  title?: string;
  created?: string;
  modified?: string;
};

async function listInvoiceDocuments(): Promise<PaperlessDocument[]> {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();
  const documents: PaperlessDocument[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${paperlessUrl}/documents/?page_size=100&page=${page}&ordering=-created&title__icontains=${encodeURIComponent(`${TITLE_PREFIX}|`)}`,
      {
        headers: {
          Authorization: `Token ${paperlessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Brak tresci bledu');
      throw new Error(`Nie mozna pobrac wpisow PWA z Paperless: ${response.status} (${errorText})`);
    }

    const payload = (await response.json().catch(() => null)) as
      | { results?: PaperlessDocument[]; next?: string | null }
      | null;
    const resultPage = Array.isArray(payload?.results) ? payload.results : [];

    documents.push(...resultPage);

    if (!payload?.next || resultPage.length === 0) {
      break;
    }

    page += 1;
    if (page > 20) {
      break;
    }
  }

  return documents;
}

function mapPaperlessDocument(document: PaperlessDocument): CompanyInvoice | null {
  if (typeof document.id !== 'number' || !document.title) {
    return null;
  }

  const parsed = parsePaperlessInvoiceTitle(document.title);
  if (!parsed) {
    return null;
  }

  const timestamp = document.created || document.modified || new Date().toISOString();

  return {
    id: String(document.id),
    date: parsed.date,
    description: parsed.description,
    amount: parsed.amount,
    documentStatus: parsed.status,
    entryType: typeTagForStatus(parsed.status),
    userEmail: parsed.userEmail,
    createdAt: timestamp,
    updatedAt: document.modified || timestamp,
  };
}

async function patchPaperlessInvoiceEntry(input: {
  id: string;
  userEmail: string;
  date: string;
  description: string;
  amount: number | null;
  status: CompanyInvoiceStatus;
}) {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();
  const numericId = Number(input.id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('Nieprawidlowe id wpisu faktury');
  }

  const title = buildPaperlessInvoiceTitle({
    userEmail: input.userEmail,
    date: input.date,
    description: input.description,
    amount: input.amount,
    status: input.status,
  });

  const tagsToApply = tagsForStatus(input.status);
  const patchRes = await fetch(`${paperlessUrl}/documents/${numericId}/`, {
    method: 'PATCH',
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text().catch(() => 'Brak tresci bledu');
    throw new Error(`Nie mozna zapisac danych wpisu: ${patchRes.status} (${err})`);
  }

  await applyCompanyTagsToDocument(numericId, tagsToApply);
}

async function getInvoiceEntryOrThrow(id: string, userEmail: string) {
  const normalizedUser = normalizeUserEmail(userEmail);
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();
  const numericId = Number(id);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('Nieprawidlowe id wpisu faktury');
  }

  const response = await fetch(`${paperlessUrl}/documents/${numericId}/`, {
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Brak tresci bledu');
    throw new Error(`Nie mozna pobrac wpisu z Paperless: ${response.status} (${errorText})`);
  }

  const document = (await response.json().catch(() => null)) as PaperlessDocument | null;
  const mapped = mapPaperlessDocument(document || {});

  if (!mapped || mapped.userEmail !== normalizedUser) {
    throw new Error('Nie znaleziono wpisu faktury dla tego uzytkownika');
  }

  if (!mapped.id || mapped.id !== id) {
    throw new Error('Nie znaleziono wpisu faktury dla tego uzytkownika');
  }

  return mapped;
}

export function getCurrentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

export function buildInvoiceSummary(invoices: CompanyInvoice[]) {
  const missing = invoices.filter((invoice) => invoice.documentStatus === 'BRAK').length;
  const pdf = invoices.filter((invoice) => invoice.documentStatus === 'PDF').length;
  const scan = invoices.filter((invoice) => invoice.documentStatus === 'SKAN').length;
  const amountTotal = invoices.reduce((sum, invoice) => sum + (invoice.amount || 0), 0);

  return {
    total: invoices.length,
    missing,
    pdf,
    scan,
    amountTotal: Number(amountTotal.toFixed(2)),
  };
}

export async function listCompanyInvoices(userEmail: string, month: string) {
  const normalizedUser = normalizeUserEmail(userEmail);
  const normalizedMonth = normalizeMonth(month);
  const documents = await listInvoiceDocuments();

  return documents
    .map(mapPaperlessDocument)
    .filter((invoice): invoice is CompanyInvoice => !!invoice)
    .filter((invoice) => invoice.userEmail === normalizedUser)
    .filter((invoice) => invoice.date.startsWith(normalizedMonth))
    .sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
}

export async function createCompanyInvoice(input: CreateCompanyInvoiceInput): Promise<CreateCompanyInvoiceResult> {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();
  const normalizedUser = normalizeUserEmail(input.userEmail);
  const normalizedDate = normalizeIsoDate(input.date);
  const normalizedDescription = normalizeDescription(input.description);
  const normalizedAmount = normalizeAmount(input.amount);

  const title = buildPaperlessInvoiceTitle({
    userEmail: normalizedUser,
    date: normalizedDate,
    description: normalizedDescription,
    amount: normalizedAmount,
    status: 'BRAK',
  });

  const payload = new FormData();
  const teaserContent = buildEntryDocumentContent({
    userEmail: normalizedUser,
    date: normalizedDate,
    description: normalizedDescription,
    amount: normalizedAmount,
    status: 'BRAK',
  });

  const file = new File([teaserContent], `zajawka-${normalizedDate}-${Date.now()}.txt`, {
    type: 'text/plain;charset=utf-8',
  });

  payload.append('document', file);
  payload.append('title', title);

  const uploadRes = await fetch(`${paperlessUrl}/documents/post_document/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
    },
    body: payload,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => 'Brak tresci bledu');
    throw new Error(`Nie mozna utworzyc wpisu zajawki w Paperless: ${uploadRes.status} (${err})`);
  }

  const taskId = (await uploadRes.text().catch(() => '')).replace(/"/g, '').trim();
  return {
    pending: true,
    invoice: null,
    taskId: taskId || '',
  };
}

export async function updateCompanyInvoiceStatus(input: {
  id: string;
  userEmail: string;
  status: CompanyInvoiceStatus;
}) {
  if (!isCompanyInvoiceStatus(input.status)) {
    throw new Error('Nieprawidlowy status dokumentu');
  }

  const existing = await getInvoiceEntryOrThrow(input.id, input.userEmail);

  await patchPaperlessInvoiceEntry({
    id: input.id,
    userEmail: existing.userEmail,
    date: existing.date,
    description: existing.description,
    amount: existing.amount,
    status: input.status,
  });

  return {
    ...existing,
    documentStatus: input.status,
    entryType: typeTagForStatus(input.status),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateCompanyInvoiceEntry(input: {
  id: string;
  userEmail: string;
  date?: string;
  description?: string;
  amount?: number | null;
  status?: CompanyInvoiceStatus;
}) {
  const existing = await getInvoiceEntryOrThrow(input.id, input.userEmail);

  const status = input.status && isCompanyInvoiceStatus(input.status)
    ? input.status
    : existing.documentStatus;

  const nextDate = typeof input.date === 'string' ? normalizeIsoDate(input.date) : existing.date;
  const nextDescription =
    typeof input.description === 'string' ? normalizeDescription(input.description) : existing.description;
  const nextAmount =
    typeof input.amount === 'undefined' ? existing.amount : normalizeAmount(input.amount ?? null);

  await patchPaperlessInvoiceEntry({
    id: input.id,
    userEmail: existing.userEmail,
    date: nextDate,
    description: nextDescription,
    amount: nextAmount,
    status,
  });

  return {
    ...existing,
    date: nextDate,
    description: nextDescription,
    amount: nextAmount,
    documentStatus: status,
    entryType: typeTagForStatus(status),
    updatedAt: new Date().toISOString(),
  };
}