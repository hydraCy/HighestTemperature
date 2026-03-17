import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CRON_JOB_SECRET?.trim();
  if (configuredSecret) {
    const incoming = req.headers.get('x-job-secret')?.trim();
    if (!incoming || incoming !== configuredSecret) {
      return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
    }
  }

  const { job, targetDate } = (await req.json().catch(() => ({}))) as { job?: string; targetDate?: string };
  const targetDateKey = typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : undefined;

  const { syncAllNow, syncMarket5m, syncModel5m, syncSettledDaily, syncWeather10m } = await import(
    '@/lib/services/refresh-service'
  );

  if (job === 'market') await syncMarket5m(targetDateKey);
  else if (job === 'weather') await syncWeather10m(targetDateKey);
  else if (job === 'model') await syncModel5m(targetDateKey);
  else if (job === 'settled') await syncSettledDaily();
  else if (job === 'all' || !job) await syncAllNow(targetDateKey);
  else return NextResponse.json({ ok: false, message: 'unknown job' }, { status: 400 });

  return NextResponse.json({ ok: true, job: job ?? 'all', targetDate: targetDateKey ?? null });
}
