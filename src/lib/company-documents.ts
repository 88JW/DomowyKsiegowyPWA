export const COMPANY_PAPERLESS_TAGS = ['Firma'] as const;
export const COMPANY_FIREFLY_TAGS = ['Firma'] as const;
export const FUEL_TAG = 'Paliwo';

type CompanyTitleInput = {
  issueDate?: string | null;
  storeName?: string | null;
  nip?: string | null;
  amount?: string | number | null;
};

function sanitizeTitleChunk(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[\[\]\/\\]/g, '-').trim();
}

export function normalizeIssueDate(rawDate?: string | null) {
  if (!rawDate) {
    return new Date().toISOString().slice(0, 10);
  }

  const trimmed = rawDate.trim();
  const isoLike = trimmed.match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/);
  if (isoLike) {
    const [, year, month, day] = isoLike;
    return `${year}-${month}-${day}`;
  }

  const plLike = trimmed.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (plLike) {
    const [, day, month, year] = plLike;
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

export function normalizeNip(rawNip?: string | null) {
  if (!rawNip) {
    return null;
  }

  const digits = rawNip.replace(/\D/g, '');
  if (digits.length !== 10) {
    return null;
  }

  return digits;
}

export function normalizeAmountForTitle(rawAmount?: string | number | null) {
  if (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) {
    return rawAmount.toFixed(2);
  }

  if (typeof rawAmount === 'string') {
    const normalized = rawAmount.replace(/\s/g, '').replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
  }

  return '0.00';
}

export function buildCompanyPaperlessTitle(input: CompanyTitleInput) {
  const datePart = normalizeIssueDate(input.issueDate);
  const storePart = sanitizeTitleChunk(input.storeName || '') || normalizeNip(input.nip) || 'NIP_NIEZNANY';
  const amountPart = normalizeAmountForTitle(input.amount);

  return `${datePart} - ${storePart} - ${amountPart}`;
}