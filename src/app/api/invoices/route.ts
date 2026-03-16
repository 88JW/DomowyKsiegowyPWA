import { NextResponse } from 'next/server';

import {
  buildInvoiceSummary,
  createCompanyInvoice,
  getCurrentMonthValue,
  listCompanyInvoices,
} from '@/lib/company-invoices';
import { getSsoIdentity } from '@/lib/sso-user';

function getInvoiceUser(identity: Awaited<ReturnType<typeof getSsoIdentity>>) {
  return identity?.user?.trim().toLowerCase() || identity?.email?.trim().toLowerCase() || null;
}

export async function GET(request: Request) {
  try {
    const identity = await getSsoIdentity();
    const userEmail = getInvoiceUser(identity);

    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'Brak tozsamosci SSO' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || getCurrentMonthValue();
    const invoices = await listCompanyInvoices(userEmail, month);

    return NextResponse.json({
      success: true,
      month,
      userEmail,
      summary: buildInvoiceSummary(invoices),
      invoices,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad pobierania faktur';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getSsoIdentity();
    const userEmail = getInvoiceUser(identity);

    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'Brak tozsamosci SSO' }, { status: 401 });
    }

    const payload = (await request.json().catch(() => null)) as
      | { date?: string; description?: string; amount?: number | string | null }
      | null;

    if (!payload?.date || !payload?.description) {
      return NextResponse.json(
        { success: false, error: 'Wymagane pola: date oraz description' },
        { status: 400 },
      );
    }

    const amount =
      typeof payload.amount === 'string'
        ? Number(payload.amount.replace(/\s/g, '').replace(',', '.'))
        : payload.amount;

    const invoice = await createCompanyInvoice({
      date: payload.date,
      description: payload.description,
      amount: typeof amount === 'number' ? amount : null,
      userEmail,
    });

    return NextResponse.json({ success: true, invoice }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad tworzenia faktury';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}