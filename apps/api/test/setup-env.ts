import { config } from 'dotenv';
import path from 'node:path';

// Тесты работают только с отдельной тестовой БД (§27: production и тест разделены).
config({ path: path.join(__dirname, '..', '.env'), quiet: true });
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL не задан');
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL совпадает с DATABASE_URL');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_ENV = 'test';
process.env.NODE_ENV = 'test';
process.env.NOTIFICATION_CHANNELS = 'dev_inbox';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = path.join(__dirname, '..', '.test-storage');
process.env.COOKIE_SECURE = 'false';
