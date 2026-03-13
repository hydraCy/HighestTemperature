import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed no longer inserts any demo/mock rows.
  // It only resets analysis tables so the system can rebuild from live APIs.
  await prisma.forecastSourceBias.deleteMany();
  await prisma.modelBinOutput.deleteMany();
  await prisma.snapshot.deleteMany();
  await prisma.modelRun.deleteMany();
  await prisma.weatherAssistSnapshot.deleteMany();
  await prisma.marketBin.deleteMany();
  await prisma.resolutionMetadata.deleteMany();
  await prisma.note.deleteMany();
  await prisma.settledResult.deleteMany();
  await prisma.market.deleteMany();

  console.log('Database cleared. No mock data inserted.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
