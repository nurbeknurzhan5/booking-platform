import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { createPgAdapter } from '../common/prisma.service';
import { seedReferenceData } from './reference-data';

/** Загрузка справочников (роли, права, тарифы, шаблоны) при развёртывании. Идемпотентно. */
async function main() {
  const prisma = new PrismaClient({ adapter: createPgAdapter(process.env.DATABASE_URL!) });
  try {
    await seedReferenceData(prisma);
    console.warn('Reference data seeded');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
