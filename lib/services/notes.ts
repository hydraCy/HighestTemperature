import { getD1 } from '@/lib/services/d1-context';

export async function addNote(marketId: string, noteText: string) {
  if (process.env.CF_USE_D1 === 'true') {
    const db = await getD1();
    if (!db) throw new Error('D1 unavailable');
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db
      .prepare(`INSERT INTO notes (id, market_id, note_text, created_at) VALUES (?, ?, ?, ?)`)
      .bind(id, marketId, noteText, createdAt)
      .run();
    return { id, marketId, noteText, createdAt };
  }
  const { prisma } = await import('@/lib/db');
  return prisma.note.create({ data: { marketId, noteText } });
}
