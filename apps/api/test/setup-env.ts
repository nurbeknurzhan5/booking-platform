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
// Тестам нужен «тестовый телефон» (OTP и ссылки подтверждения читаются из dev_inbox).
process.env.DEV_INBOX_ENABLED = 'true';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = path.join(__dirname, '..', '.test-storage');
process.env.COOKIE_SECURE = 'false';
// supertest обращается к API напрямую и сам пишет X-Forwarded-For — как один доверенный прокси (Caddy в production).
// Не зависит от TRUST_PROXY в apps/api/.env (локально там 0: перед API только Next.js, D-54).
process.env.TRUST_PROXY = '1';
process.env.STORAGE_PUBLIC_BASE_URL = '/api/v1/media';
process.env.GOOGLE_TRANSLATE_API_KEY = '';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.SMS_API_KEY = '';
