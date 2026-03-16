import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COMPANY_INVOICE_STATUSES = ['BRAK', 'PDF', 'SKAN'] as const;

export type CompanyInvoiceStatus = (typeof COMPANY_INVOICE_STATUSES)[number];

export type CompanyInvoice = {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  documentStatus: CompanyInvoiceStatus;
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

const DEFAULT_STORE_PATH = path.join(process.cwd(), '.data', 'company-invoices.json');

function getStorePath() {
  const customPath = process.env.COMPANY_INVOICES_STORE_PATH?.trim();
  return customPath || DEFAULT_STORE_PATH;
}

async function ensureStoreFile() {
  const storePath = getStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });

  try {
    await readFile(storePath, 'utf8');
  } catch {
    await writeFile(storePath, '[]\n', 'utf8');
  }

  return storePath;
}

async function readStore(): Promise<CompanyInvoice[]> {
  const storePath = await ensureStoreFile();
  const raw = await readFile(storePath, 'utf8');

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isCompanyInvoice);
  } catch {
    return [];
  }
}

async function writeStore(invoices: CompanyInvoice[]) {
  const storePath = await ensureStoreFile();
  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(invoices, null, 2)}\n`, 'utf8');
  await rename(tempPath, storePath);
}

function isCompanyInvoiceStatus(value: unknown): value is CompanyInvoiceStatus {
  return typeof value === 'string' && COMPANY_INVOICE_STATUSES.includes(value as CompanyInvoiceStatus);
}

function isCompanyInvoice(value: unknown): value is CompanyInvoice {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.date === 'string' &&
    typeof candidate.description === 'string' &&
    (typeof candidate.amount === 'number' || candidate.amount === null) &&
    isCompanyInvoiceStatus(candidate.documentStatus) &&
    typeof candidate.userEmail === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
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
  const invoices = await readStore();

  return invoices
    .filter((invoice) => invoice.userEmail === normalizedUser && invoice.date.startsWith(normalizedMonth))
    .sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
}

export async function createCompanyInvoice(input: CreateCompanyInvoiceInput) {
  const invoices = await readStore();
  const timestamp = new Date().toISOString();

  const invoice: CompanyInvoice = {
    id: crypto.randomUUID(),
    date: normalizeIsoDate(input.date),
    description: normalizeDescription(input.description),
    amount: normalizeAmount(input.amount),
    documentStatus: 'BRAK',
    userEmail: normalizeUserEmail(input.userEmail),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  invoices.push(invoice);
  await writeStore(invoices);

  return invoice;
}

export async function updateCompanyInvoiceStatus(input: {
  id: string;
  userEmail: string;
  status: CompanyInvoiceStatus;
}) {
  const invoices = await readStore();
  const normalizedUser = normalizeUserEmail(input.userEmail);
  const index = invoices.findIndex((invoice) => invoice.id === input.id && invoice.userEmail === normalizedUser);

  if (index === -1) {
    throw new Error('Nie znaleziono wpisu faktury dla tego uzytkownika');
  }

  if (!isCompanyInvoiceStatus(input.status)) {
    throw new Error('Nieprawidlowy status dokumentu');
  }

  const updatedInvoice: CompanyInvoice = {
    ...invoices[index],
    documentStatus: input.status,
    updatedAt: new Date().toISOString(),
  };

  invoices[index] = updatedInvoice;
  await writeStore(invoices);

  return updatedInvoice;
}