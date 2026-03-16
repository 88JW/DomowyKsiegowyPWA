import { NextResponse } from 'next/server';

import { updateCompanyInvoiceStatus } from '@/lib/company-invoices';
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
    const payload = (await request.json().catch(() => null)) as { status?: string } | null;

    if (!payload?.status) {
      return NextResponse.json({ success: false, error: 'Brak nowego statusu' }, { status: 400 });
    }

    const invoice = await updateCompanyInvoiceStatus({
      id,
      userEmail,
      status: payload.status as 'BRAK' | 'PDF' | 'SKAN',
    });

    return NextResponse.json({ success: true, invoice });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad aktualizacji statusu';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}