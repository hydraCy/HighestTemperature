import { NextRequest, NextResponse } from 'next/server';

function normalizeDateKey(input: string | null | undefined) {
  if (!input) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : null;
}

export async function POST(req: NextRequest) {
  try {
    const targetDateKey = normalizeDateKey(req.nextUrl.searchParams.get('d'));
    const { syncAllNow } = await import('@/lib/services/refresh-service');
    const result = await syncAllNow(targetDateKey);
    return NextResponse.json({ ok: true, decision: result?.decision?.decision ?? null });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : '刷新失败'
      },
      { status: 500 }
    );
  }
}
