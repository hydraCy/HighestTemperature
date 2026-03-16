import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const schema = z.object({
  marketId: z.string(),
  noteText: z.string().min(1)
});

export async function POST(req: NextRequest) {
  if (process.env.CF_MVP_MODE === 'true') {
    return NextResponse.json(
      { ok: false, message: 'Cloudflare MVP 模式下该接口暂不可用' },
      { status: 501 }
    );
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { addNote } = await import('@/lib/services/notes');
  const note = await addNote(parsed.data.marketId, parsed.data.noteText);
  return NextResponse.json({ ok: true, note });
}
