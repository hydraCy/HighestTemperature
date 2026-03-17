export async function addNote(marketId: string, noteText: string) {
  const { prisma } = await import('@/lib/db');
  return prisma.note.create({ data: { marketId, noteText } });
}
