const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getPaperlessConfig() {
  const paperlessUrl = process.env.PAPERLESS_API_URL;
  const paperlessToken = process.env.PAPERLESS_API_TOKEN;

  if (!paperlessUrl || !paperlessToken) {
    throw new Error('Brak konfiguracji Paperless API w zmiennych srodowiskowych');
  }

  return { paperlessUrl, paperlessToken };
}

function flattenCustomFields(customFields: unknown): string {
  if (!customFields) return '';
  try {
    if (Array.isArray(customFields)) {
      return customFields
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const obj = item as Record<string, unknown>;
          const label = obj.name || obj.field || obj.label || '';
          const value = obj.value || obj.text || obj.content || '';
          return `${String(label)} ${String(value)}`.trim();
        })
        .filter(Boolean)
        .join(' ');
    }
    if (typeof customFields === 'object') {
      return Object.values(customFields as Record<string, unknown>)
        .map((v) => String(v ?? ''))
        .join(' ');
    }
    return String(customFields);
  } catch {
    return '';
  }
}

export function extractAmountFromText(text: string): string | null {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, ' ');
  const amountPattern = '(\\d{1,3}(?:[ .]\\d{3})*(?:[,.]\\d{2})|\\d+[,.]\\d{2})';

  const sumaMatch = normalized.match(
    new RegExp(`(?:SUMA|RAZEM|TOTAL)\\s*[:\\-]?\\s*${amountPattern}`, 'i'),
  );
  if (sumaMatch?.[1]) {
    return sumaMatch[1].replace(/\s/g, '').replace(',', '.');
  }

  const plnRegex = new RegExp(`(${amountPattern})\\s*(?:PLN|ZL|ZŁ)`, 'gi');
  const plnMatches = [...normalized.matchAll(plnRegex)];
  if (plnMatches.length > 0) {
    const amount = plnMatches[plnMatches.length - 1]?.[1];
    if (amount) return amount.replace(/\s/g, '').replace(',', '.');
  }

  const genericMatches = [...normalized.matchAll(new RegExp(amountPattern, 'g'))];
  const withDecimals = genericMatches
    .map((m) => m[1])
    .filter((v) => /[,.]\d{2}$/.test(v));

  if (withDecimals.length > 0) {
    return withDecimals[withDecimals.length - 1].replace(/\s/g, '').replace(',', '.');
  }

  return null;
}

export async function uploadToPaperlessOnly(file: File, title: string) {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();

  const uniqueTitle = `OCR-${Date.now()}-${title}`;
  const payload = new FormData();
  payload.append('document', file);
  payload.append('title', uniqueTitle);

  const uploadRes = await fetch(`${paperlessUrl}/documents/post_document/`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
    },
    body: payload,
  });

  if (!uploadRes.ok) {
    const uploadErr = await uploadRes.text().catch(() => 'Brak tresci bledu');
    const errMsg = `Paperless upload blad: ${uploadRes.status} (${uploadErr})`;
    console.error('[OCR]', errMsg);
    return { success: false as const, error: errMsg };
  }

  // Paperless returns a task UUID — poll for the document ID using task API
  const taskUuid = await uploadRes.text().catch(() => '');
  const cleanUuid = taskUuid.replace(/"/g, '').trim();
  console.log('[OCR] Task UUID:', cleanUuid);

  // First try task API if we have a UUID
  if (cleanUuid && cleanUuid.length > 10) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(1000);
      const taskRes = await fetch(`${paperlessUrl}/tasks/?task_id=${encodeURIComponent(cleanUuid)}`, {
        headers: {
          Authorization: `Token ${paperlessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });
      if (taskRes.ok) {
        const taskJson = (await taskRes.json().catch(() => null)) as
          | Array<{ status?: string; related_document?: number | null }>
          | null;
        const task = Array.isArray(taskJson) ? taskJson[0] : null;
        console.log(`[OCR] Task attempt ${attempt + 1}: status=${task?.status} docId=${task?.related_document}`);
        if (task?.status === 'SUCCESS' && task.related_document) {
          return { success: true as const, documentId: task.related_document, taskId: cleanUuid };
        }
        if (task?.status === 'FAILURE') {
          return { success: false as const, error: 'Paperless zwrocil blad przetwarzania zadania' };
        }
      }
    }

    // Task still in queue/processing; let frontend poll by taskId.
    return { success: true as const, documentId: null, taskId: cleanUuid };
  }

  // Fallback: search by title
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(500);
    const listRes = await fetch(
      `${paperlessUrl}/documents/?title__icontains=${encodeURIComponent(uniqueTitle)}&ordering=-created&page_size=1`,
      {
        headers: {
          Authorization: `Token ${paperlessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );
    if (listRes.ok) {
      const listJson = (await listRes.json().catch(() => null)) as
        | { results?: Array<{ id?: number }> }
        | null;
      const documentId = listJson?.results?.[0]?.id;
      if (documentId) return { success: true as const, documentId, taskId: cleanUuid || null };
    }
  }

  return { success: false as const, error: 'Dokument wyslany, ale nie udalo sie pobrac ID' };
}

export async function getTaskState(taskId: string) {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();

  const taskRes = await fetch(`${paperlessUrl}/tasks/?task_id=${encodeURIComponent(taskId)}`, {
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!taskRes.ok) {
    const err = await taskRes.text().catch(() => 'Brak tresci bledu');
    return { success: false as const, error: `Paperless task blad: ${taskRes.status} (${err})` };
  }

  const taskJson = (await taskRes.json().catch(() => null)) as
    | Array<{ status?: string; related_document?: number | null }>
    | null;

  const task = Array.isArray(taskJson) ? taskJson[0] : null;
  const status = task?.status || 'UNKNOWN';
  const relatedDocument = task?.related_document || null;

  return {
    success: true as const,
    status,
    relatedDocument,
    done: status === 'SUCCESS' || status === 'FAILURE',
  };
}

export async function getOcrData(documentId: number) {
  const { paperlessUrl, paperlessToken } = getPaperlessConfig();

  const ocrRes = await fetch(`${paperlessUrl}/documents/${documentId}/`, {
    headers: {
      Authorization: `Token ${paperlessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!ocrRes.ok) {
    const err = await ocrRes.text().catch(() => 'Brak tresci');
    return { success: false as const, error: `Paperless OCR blad: ${ocrRes.status} (${err})` };
  }

  const ocrJson = (await ocrRes.json().catch(() => null)) as
    | {
        content?: string | null;
        custom_fields?: unknown;
        custom_fields_text?: string;
        is_ocr_finished?: boolean;
      }
    | null;

  const content = ocrJson?.content ?? '';
  const customFieldText = ocrJson?.custom_fields_text || flattenCustomFields(ocrJson?.custom_fields);
  const apiFinished = ocrJson?.is_ocr_finished === true;
  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasCustomText = typeof customFieldText === 'string' && customFieldText.trim().length > 0;
  const isOcrDone = apiFinished || hasContent || hasCustomText;

  return { success: true as const, content, customFieldText, isOcrDone };
}
