import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addNote } from '@/lib/services/notes';

const schema = z.object({
  marketId: z.string(),
  noteText: z.string().min(1)
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const note = await addNote(parsed.data.marketId, parsed.data.noteText);
  return NextResponse.json({ ok: true, note });
}
