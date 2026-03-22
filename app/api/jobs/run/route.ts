import { NextRequest, NextResponse } from 'next/server';
import { normalizeDateKey } from '@/lib/config/pipeline-request';
import { normalizeLocationKey } from '@/lib/config/locations';

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CRON_JOB_SECRET?.trim();
  if (configuredSecret) {
    const incoming = req.headers.get('x-job-secret')?.trim();
    if (!incoming || incoming !== configuredSecret) {
      return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
    }
  }

  const { job, targetDate, locationKey } = (await req.json().catch(() => ({}))) as {
    job?: string;
    targetDate?: string;
    locationKey?: string;
  };
  const targetDateKey = normalizeDateKey(targetDate);
  const normalizedLocationKey = normalizeLocationKey(locationKey);
  const request = { locationKey: normalizedLocationKey, targetDate: targetDateKey };

  const { syncAllNow, syncMarket5m, syncModel5m, syncSettledDaily, syncWeather10m } = await import(
    '@/lib/services/refresh-service'
  );

  if (job === 'market') await syncMarket5m(request);
  else if (job === 'weather') await syncWeather10m(request);
  else if (job === 'model') await syncModel5m(request);
  else if (job === 'settled') await syncSettledDaily();
  else if (job === 'all' || !job) await syncAllNow(request);
  else return NextResponse.json({ ok: false, message: 'unknown job' }, { status: 400 });

  return NextResponse.json({
    ok: true,
    job: job ?? 'all',
    locationKey: normalizedLocationKey,
    targetDate: targetDateKey ?? null
  });
}
