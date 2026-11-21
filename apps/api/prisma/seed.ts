import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPgAdapter } from '../src/common/prisma.service';
import { seedReferenceData } from '../src/seed/reference-data';

async function main() {
  const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL!) });
  try {
    await seedReferenceData(prisma);
    if (process.argv.includes('--demo')) {
      const { seedDemoData } = await import('../src/seed/demo-data');
      await seedDemoData(prisma);
      const { seedDemoVenues } = await import('../src/seed/demo-venues');
      await seedDemoVenues(prisma);
    }
    // eslint-disable-next-line no-console
    console.log('Seed completed');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
