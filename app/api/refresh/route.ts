import { NextResponse } from 'next/server';
import { syncAllNow } from '@/lib/services/refresh-service';

export async function POST() {
  try {
    const result = await syncAllNow();
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
