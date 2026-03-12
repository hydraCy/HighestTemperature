import { NextRequest, NextResponse } from 'next/server';
import { syncAllNow, syncMarket5m, syncModel5m, syncSettledDaily, syncWeather10m } from '@/lib/services/refresh-service';

export async function POST(req: NextRequest) {
  const { job } = (await req.json().catch(() => ({}))) as { job?: string };

  if (job === 'market') await syncMarket5m();
  else if (job === 'weather') await syncWeather10m();
  else if (job === 'model') await syncModel5m();
  else if (job === 'settled') await syncSettledDaily();
  else if (job === 'all' || !job) await syncAllNow();
  else return NextResponse.json({ ok: false, message: 'unknown job' }, { status: 400 });

  return NextResponse.json({ ok: true, job: job ?? 'all' });
}
