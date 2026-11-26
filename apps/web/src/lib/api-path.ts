// Фабрика ApiPath — только для этого модуля (присваивается в static-блоке класса).
let fromEncoded: (value: string) => ApiPath;

/**
 * Путь запроса к API. Собирается только тегом apiPath`…`: каждое подставленное значение (id из адреса, токен, slug,
 * строка поиска) кодируется encodeURIComponent, поэтому «../», «/», «?», «#» из параметров маршрута или данных
 * не меняют маршрут API. api(), useApi(), serverGet() и uploadFile() принимают только ApiPath — обычную строку
 * передать нельзя (проверяет TypeScript).
 *
 * Без кодирования подставляются только уже собранные части: другой ApiPath (например base организации)
 * и URLSearchParams (строка запроса). Создать ApiPath можно только в этом модуле: конструктор закрыт.
 */
export class ApiPath {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static {
    fromEncoded = (value) => new ApiPath(value);
  }

  toString(): string {
    return this.#value;
  }
}

export type ApiPathValue = string | number | ApiPath | URLSearchParams;

export function apiPath(strings: TemplateStringsArray, ...values: ApiPathValue[]): ApiPath {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    let part: string;
    if (v instanceof ApiPath || v instanceof URLSearchParams) part = v.toString();
    else {
      part = encodeURIComponent(String(v));
      // «.» и «..» encodeURIComponent не меняет, а URL-парсер схлопывает такие сегменты (и %2E%2E) — в пути запрещены
      if (!out.includes('?') && /^\.{1,2}$/.test(part)) throw new Error('Недопустимое значение в пути запроса к API');
    }
    out += part + (strings[i + 1] ?? '');
  });
  return fromEncoded(out);
}

/** Строка запроса «?a=1&b=2» без пустых значений (null/undefined/''); пустая — ''. */
export function apiQuery(params: Record<string, string | number | boolean | null | undefined>): ApiPath {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return fromEncoded(s ? `?${s}` : '');
}

/** UUID (идентификаторы организаций, филиалов и записей). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
