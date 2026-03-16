import { NextResponse } from 'next/server';

import { updateCompanyInvoiceEntry } from '@/lib/company-invoices';
import { getSsoIdentity } from '@/lib/sso-user';

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getInvoiceUser(identity: Awaited<ReturnType<typeof getSsoIdentity>>) {
  return identity?.user?.trim().toLowerCase() || identity?.email?.trim().toLowerCase() || null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await getSsoIdentity();
    const userEmail = getInvoiceUser(identity);

    if (!userEmail) {
      return NextResponse.json({ success: false, error: 'Brak tozsamosci SSO' }, { status: 401 });
    }

    const { id } = await context.params;
    const payload = (await request.json().catch(() => null)) as
      | { date?: string; description?: string; amount?: number | string | null; status?: string }
      | null;

    if (!payload) {
      return NextResponse.json({ success: false, error: 'Brak danych do aktualizacji' }, { status: 400 });
    }

    const normalizedAmount =
      typeof payload.amount === 'string'
        ? Number(payload.amount.replace(/\s/g, '').replace(',', '.'))
        : payload.amount;

    const amountValue =
      typeof normalizedAmount === 'number' && Number.isFinite(normalizedAmount)
        ? normalizedAmount
        : payload.amount === null
          ? null
          : undefined;

    const invoice = await updateCompanyInvoiceEntry({
      id,
      userEmail,
      date: payload.date,
      description: payload.description,
      amount: amountValue,
      status: payload.status as 'BRAK' | 'PDF' | 'SKAN' | undefined,
    });

    return NextResponse.json({ success: true, invoice });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad aktualizacji wpisu';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
