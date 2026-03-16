import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  if (process.env.CF_MVP_MODE === 'true' || process.env.CF_USE_D1 === 'true') {
    return NextResponse.json(
      { ok: false, message: 'Cloudflare MVP 模式下该接口暂不可用' },
      { status: 501 }
    );
  }
  const { job } = (await req.json().catch(() => ({}))) as { job?: string };
  const { syncAllNow, syncMarket5m, syncModel5m, syncSettledDaily, syncWeather10m } = await import(
    '@/lib/services/refresh-service'
  );

  if (job === 'market') await syncMarket5m();
  else if (job === 'weather') await syncWeather10m();
  else if (job === 'model') await syncModel5m();
  else if (job === 'settled') await syncSettledDaily();
  else if (job === 'all' || !job) await syncAllNow();
  else return NextResponse.json({ ok: false, message: 'unknown job' }, { status: 400 });

  return NextResponse.json({ ok: true, job: job ?? 'all' });
}
