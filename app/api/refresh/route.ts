import { NextRequest, NextResponse } from 'next/server';
import { normalizeDateKey } from '@/lib/config/pipeline-request';
import { normalizeLocationKey } from '@/lib/config/locations';

export async function POST(req: NextRequest) {
  try {
    const targetDateKey = normalizeDateKey(req.nextUrl.searchParams.get('d'));
    const locationKey = normalizeLocationKey(req.nextUrl.searchParams.get('l'));
    const { syncAllNow } = await import('@/lib/services/refresh-service');
    const result = await syncAllNow({
      locationKey,
      targetDate: targetDateKey
    });
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
