import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedReferenceData } from '../src/seed/reference-data';

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    await seedReferenceData(prisma);
    if (process.argv.includes('--demo')) {
      const { seedDemoData } = await import('../src/seed/demo-data');
      await seedDemoData(prisma);
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
