import { NextResponse } from 'next/server';

export async function POST() {
  if (process.env.CF_MVP_MODE === 'true' || process.env.CF_USE_D1 === 'true') {
    return NextResponse.json(
      { ok: false, message: 'Cloudflare MVP 模式下该接口暂不可用' },
      { status: 501 }
    );
  }
  try {
    const { syncAllNow } = await import('@/lib/services/refresh-service');
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
