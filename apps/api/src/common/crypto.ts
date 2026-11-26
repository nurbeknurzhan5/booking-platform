import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(secretB64: string, input: string): string {
  return createHmac('sha256', Buffer.from(secretB64, 'base64')).update(input).digest('hex');
}

/** Сравнение хэшей за постоянное время. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Сравнение строковых секретов (CSRF-токены и т. п.) за постоянное время. */
export function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Криптостойкий токен (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** 6-значный OTP из CSPRNG. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** AES-256-GCM: результат «v1.iv.tag.ciphertext» в base64url. */
export function encrypt(keyB64: string, plaintext: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(keyB64: string, payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split('.');
  if (v !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported ciphertext format');
  const iv = Buffer.from(ivB, 'base64url');
  const tag = Buffer.from(tagB, 'base64url');
  // Явная длина тега: усечённый тег ослабил бы аутентификацию шифротекста (Node DEP0182).
  if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) throw new Error('Invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

/** Стабильный хэш тела запроса для идемпотентности. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
