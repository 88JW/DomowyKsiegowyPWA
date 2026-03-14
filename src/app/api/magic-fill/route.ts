import { NextResponse } from 'next/server';
import {
  extractAmountFromText,
  getOcrData,
  getTaskState,
  uploadToPaperlessOnly,
} from '../../../lib/paperless-ocr';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string | null) || 'Paragon';

    if (!file || file.size <= 0) {
      return NextResponse.json(
        { success: false, error: 'Nie wybrano pliku do analizy OCR' },
        { status: 400 },
      );
    }

    const uploadResult = await uploadToPaperlessOnly(file, title);

    if (!uploadResult.success) {
      return NextResponse.json({ success: false, error: uploadResult.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      documentId: uploadResult.documentId || null,
      taskId: uploadResult.taskId || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad uploadu OCR';
    console.error('[OCR POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const documentIdParam = searchParams.get('documentId');
    const taskId = searchParams.get('taskId');
    let documentId = documentIdParam ? Number(documentIdParam) : 0;
    let taskMarkedDone = false;

    if ((!documentIdParam || !Number.isInteger(documentId) || documentId <= 0) && taskId) {
      const taskState = await getTaskState(taskId);
      if (!taskState.success) {
        return NextResponse.json({ success: false, error: taskState.error }, { status: 502 });
      }

      if (taskState.status === 'FAILURE') {
        return NextResponse.json(
          { success: false, error: 'Paperless nie przetworzyl dokumentu' },
          { status: 502 },
        );
      }

      const relatedDocId = taskState.relatedDocument ? Number(taskState.relatedDocument) : 0;
      if (Number.isInteger(relatedDocId) && relatedDocId > 0) {
        documentId = relatedDocId;
        taskMarkedDone = taskState.status === 'SUCCESS';
      } else {
        return NextResponse.json({
          success: true,
          queued: true,
          isOcrDone: false,
          hasContent: false,
          amount: null,
        });
      }
    }

    if (!Number.isInteger(documentId) || documentId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Nieprawidlowe documentId/taskId' },
        { status: 400 },
      );
    }

    const ocrResult = await getOcrData(documentId);
    if (!ocrResult.success) {
      return NextResponse.json(
        { success: false, error: ocrResult.error },
        { status: 502 },
      );
    }

    const text = `${ocrResult.content || ''} ${ocrResult.customFieldText || ''}`.trim();
    const isOcrDone = (ocrResult.isOcrDone ?? false) || taskMarkedDone;
    const amount = isOcrDone ? extractAmountFromText(text) : null;

    return NextResponse.json({
      success: true,
      isOcrDone,
      hasContent: text.length > 0,
      documentId,
      amount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Nieznany blad OCR';
    console.error('[OCR GET]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
