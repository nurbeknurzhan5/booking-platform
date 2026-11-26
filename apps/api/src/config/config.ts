import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const secret32 = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'Ожидается 32 байта в base64');

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.string().default('info'),
    WEB_ORIGIN: z.string().default('http://localhost:3000'),
    PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
    /**
     * Сколько «пишущих» X-Forwarded-For прокси перед API (D-54). 0 — заголовок игнорируется, IP = адрес соединения.
     * Next.js (rewrite) присланный клиентом заголовок пропускает как есть, поэтому 1 — только за Caddy (production).
     */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    COOKIE_SECURE: bool,
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(20),
    OTP_HMAC_SECRET: secret32,
    ENCRYPTION_KEY: secret32,
    ANALYTICS_SECRET: secret32,
    NOTIFICATION_CHANNELS: csv,
    OTP_CHANNELS: csv,
    WHATSAPP_API_BASE_URL: z.string().default('https://graph.facebook.com'),
    WHATSAPP_API_VERSION: z.string().default('v23.0'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_APP_SECRET: z.string().optional().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
    SMS_PROVIDER: z.string().default('mobizon'),
    SMS_API_BASE_URL: z.string().default('https://api.mobizon.kz'),
    SMS_API_KEY: z.string().optional().default(''),
    SMS_SENDER: z.string().optional().default(''),
    GOOGLE_TRANSLATE_API_KEY: z.string().optional().default(''),
    GOOGLE_TRANSLATE_BASE_URL: z.string().default('https://translation.googleapis.com'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    STORAGE_PUBLIC_BASE_URL: z.string().default('/api/v1/media'),
    S3_ENDPOINT: z.string().optional().default(''),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_BUCKET: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
    S3_FORCE_PATH_STYLE: bool,
    MAX_UPLOAD_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),
    WORKER_ID: z.string().optional(),
    /**
     * «Тестовый телефон»: канал dev_inbox и GET /dev/inbox. Включается только явно (dev/Codespaces/CI/тесты);
     * в production запрещён.
     */
    DEV_INBOX_ENABLED: bool,
  })
  .superRefine((env, ctx) => {
    if (env.NOTIFICATION_CHANNELS.includes('dev_inbox') && !env.DEV_INBOX_ENABLED && env.APP_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['NOTIFICATION_CHANNELS'],
        message: 'канал dev_inbox включается только вместе с DEV_INBOX_ENABLED=true (тестовый телефон)',
      });
    }
    if (env.APP_ENV === 'production') {
      if (env.DEV_INBOX_ENABLED) {
        ctx.addIssue({ code: 'custom', path: ['DEV_INBOX_ENABLED'], message: 'тестовый телефон (dev_inbox) запрещён в production' });
      }
      if (env.NOTIFICATION_CHANNELS.includes('dev_inbox')) {
        ctx.addIssue({ code: 'custom', path: ['NOTIFICATION_CHANNELS'], message: 'dev_inbox запрещён в production' });
      }
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'В production cookie должны быть Secure' });
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Fail-closed: production-сборка без явного APP_ENV не должна молча стать «development»
  // (иначе включились бы dev-возможности).
  if (env.NODE_ENV === 'production' && !env.APP_ENV?.trim()) {
    throw new Error('Некорректная конфигурация окружения: APP_ENV: при NODE_ENV=production значение APP_ENV нужно задать явно (production | test | development)');
  }
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация окружения: ${issues}`);
  }
  return parsed.data;
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** «Тестовый телефон» (dev_inbox) доступен: только по явному флагу и никогда в production. */
export function devInboxEnabled(cfg: AppConfig = getConfig()): boolean {
  return cfg.DEV_INBOX_ENABLED && cfg.APP_ENV !== 'production';
}

/** Только для тестов. */
export function resetConfigCache(): void {
  cached = null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
