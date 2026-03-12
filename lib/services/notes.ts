import { prisma } from '@/lib/db';

export async function addNote(marketId: string, noteText: string) {
  return prisma.note.create({ data: { marketId, noteText } });
}
