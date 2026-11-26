import { DateTime } from 'luxon';

/**
 * Движок доступности (§7, §8.7, §8.8). Чистые функции без доступа к БД.
 * Все интервалы — полуоткрытые [start, end) в миллисекундах UTC.
 */

export interface Interval {
  start: number;
  end: number;
}

export interface MinuteInterval {
  start: number; // минуты от полуночи (локальное время филиала)
  end: number;
}

export interface WeeklyRule {
  weekday: number; // 1..7 ISO
  start: number;
  end: number;
}

export interface ExceptionRule {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  kind: 'closed' | 'custom_hours';
  intervals: MinuteInterval[];
}

export interface ScheduleSource {
  hours: WeeklyRule[];
  breaks: WeeklyRule[];
  exceptions: ExceptionRule[];
}

export interface EngineService {
  id: string;
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  requiresSpecialist: boolean;
  requirements: Array<{ resourceType: string; quantity: number }>;
}

export interface EngineResource {
  id: string;
  type: string;
  /** Для специалистов — id карточки специалиста. */
  specialistId: string | null;
  name: string;
  sortOrder: number;
  serviceIds: ReadonlySet<string>;
  /** Доступные окна на дату (уже с учётом филиала, перерывов, исключений). */
  available: Interval[];
  /** Занятость (активные записи и действующие резервы), отсортирована по start. */
  busy: Interval[];
  /** Загрузка за день в минутах (для равномерного распределения). */
  loadMinutes: number;
}

export interface RequestItem {
  serviceId: string;
  specialistId?: string | null;
  /** Групповая бронь (D-41): число одинаковых мест; требование к ресурсу умножается на него. */
  seats?: number;
  /** Места подряд по порядку ресурсов (sortOrder) — «сидеть рядом». */
  together?: boolean;
}

export interface EngineSettings {
  slotIntervalMinutes: number;
  multiServiceMode: 'sequential' | 'parallel';
  loadBalancing: boolean;
  /** Самое раннее допустимое начало (now + min lead). */
  earliestStart: number;
  /** Самое позднее допустимое начало (горизонт). */
  latestStart: number;
}

export interface AssignedItem {
  position: number;
  serviceId: string;
  start: number;
  end: number;
  /** Интервал занятости с буферами. */
  occupancy: Interval;
  specialistId: string | null;
  specialistResourceId: string | null;
  resourceIds: string[];
  seats: number;
}

export interface SlotAssignment {
  start: number;
  end: number;
  items: AssignedItem[];
}

const MIN = 60_000;
const MAX_SEARCH_STEPS = 5000;

// ---------- операции с интервалами ----------

export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  const A = normalize(a);
  const B = normalize(b);
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i]!.start, B[j]!.start);
    const e = Math.min(A[i]!.end, B[j]!.end);
    if (e > s) out.push({ start: s, end: e });
    if (A[i]!.end < B[j]!.end) i++;
    else j++;
  }
  return out;
}

export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let result = normalize(a);
  for (const cut of normalize(b)) {
    const next: Interval[] = [];
    for (const r of result) {
      if (cut.end <= r.start || cut.start >= r.end) {
        next.push(r);
        continue;
      }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    result = next;
  }
  return result;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function contains(windows: Interval[], x: Interval): boolean {
  return windows.some((w) => w.start <= x.start && x.end <= w.end);
}

function isBusy(busy: Interval[], x: Interval): boolean {
  // busy отсортирован по start — ранний выход
  for (const b of busy) {
    if (b.start >= x.end) return false;
    if (b.end > x.start) return true;
  }
  return false;
}

// ---------- расписание на дату ----------

/** Полночь локальной даты в часовом поясе филиала → UTC ms. */
export function localMidnight(date: string, timezone: string): DateTime {
  const dt = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!dt.isValid) throw new Error(`Invalid date ${date}`);
  return dt;
}

function minutesToInstant(midnight: DateTime, minutes: number): number {
  // Через plus({minutes}) — корректно при переходах на летнее время.
  return midnight.plus({ minutes }).toMillis();
}

function exceptionFor(exceptions: ExceptionRule[], date: string): ExceptionRule | undefined {
  // Приоритет у «закрыто», затем у самого узкого диапазона.
  // Порядок строк из БД не задан — выбор должен быть детерминированным: самый узкий диапазон,
  // при равной ширине — начавшийся позже (более свежее правило). Даты YYYY-MM-DD сравниваются строками.
  const hits = exceptions.filter((e) => e.dateFrom <= date && date <= e.dateTo);
  const width = (e: ExceptionRule) => DateTime.fromISO(e.dateTo).diff(DateTime.fromISO(e.dateFrom), 'days').days;
  const narrowest = [...hits].sort((a, b) => width(a) - width(b) || (a.dateFrom < b.dateFrom ? 1 : a.dateFrom > b.dateFrom ? -1 : 0));
  return hits.find((e) => e.kind === 'closed') ?? narrowest[0];
}

/**
 * Окна работы на дату по источнику расписания.
 * inherit — окна родителя (филиала), если у ресурса нет своего недельного расписания.
 */
export function dayWindows(src: ScheduleSource, date: string, timezone: string, inherit?: Interval[]): Interval[] {
  const midnight = localMidnight(date, timezone);
  const weekday = midnight.weekday;
  const toUtc = (m: MinuteInterval): Interval => ({ start: minutesToInstant(midnight, m.start), end: minutesToInstant(midnight, m.end) });

  const ex = exceptionFor(src.exceptions, date);
  if (ex?.kind === 'closed') return [];

  let base: Interval[];
  if (ex?.kind === 'custom_hours') base = ex.intervals.map(toUtc);
  else if (src.hours.length > 0) base = src.hours.filter((h) => h.weekday === weekday).map(toUtc);
  else base = inherit ? inherit.map((i) => ({ ...i })) : [];

  const breaks = src.breaks.filter((b) => b.weekday === weekday).map(toUtc);
  return subtract(normalize(base), breaks);
}

/** Смена специалиста на дату: рабочий интервал минус перерыв (режим графика «по сменам», задача 21). */
export interface ShiftRule {
  startMinute: number;
  endMinute: number;
  breakStart: number | null;
  breakEnd: number | null;
}

export function shiftWindows(shift: ShiftRule, date: string, timezone: string): Interval[] {
  const midnight = localMidnight(date, timezone);
  const work = [{ start: minutesToInstant(midnight, shift.startMinute), end: minutesToInstant(midnight, shift.endMinute) }];
  const brk = shift.breakStart !== null && shift.breakEnd !== null ? [{ start: minutesToInstant(midnight, shift.breakStart), end: minutesToInstant(midnight, shift.breakEnd) }] : [];
  return subtract(work, brk);
}

/** Минуты от локальной полуночи для момента времени (обратное преобразование). */
export function instantToMinutes(instant: number, date: string, timezone: string): number {
  return Math.round((instant - localMidnight(date, timezone).toMillis()) / MIN);
}

// ---------- поиск назначения ----------

interface ItemPlan {
  position: number;
  service: EngineService;
  specialistId: string | null;
  seats: number;
  together: boolean;
  start: number;
  end: number;
  occupancy: Interval;
}

function planItems(services: EngineService[], items: RequestItem[], start: number, mode: 'sequential' | 'parallel'): ItemPlan[] {
  const plans: ItemPlan[] = [];
  items.forEach((it, idx) => {
    const svc = services.find((s) => s.id === it.serviceId)!;
    let s: number;
    if (mode === 'parallel' || idx === 0) s = start;
    else {
      // Следующая услуга начинается после буфера «после» предыдущей и буфера «до» текущей.
      const prev = plans[idx - 1]!;
      s = prev.end + prev.service.bufferAfterMinutes * MIN + svc.bufferBeforeMinutes * MIN;
    }
    const e = s + svc.durationMinutes * MIN;
    plans.push({
      position: idx,
      service: svc,
      specialistId: it.specialistId ?? null,
      seats: Math.max(1, it.seats ?? 1),
      together: !!it.together,
      start: s,
      end: e,
      occupancy: { start: s - svc.bufferBeforeMinutes * MIN, end: e + svc.bufferAfterMinutes * MIN },
    });
  });
  return plans;
}

function orderCandidates(list: EngineResource[], loadBalancing: boolean, extraLoad: Map<string, number>): EngineResource[] {
  return [...list].sort((a, b) => {
    if (loadBalancing) {
      const la = a.loadMinutes + (extraLoad.get(a.id) ?? 0);
      const lb = b.loadMinutes + (extraLoad.get(b.id) ?? 0);
      if (la !== lb) return la - lb;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Поиск полного назначения для заданного времени начала. Детерминированный DFS с возвратом:
 * для каждой услуги выбирается специалист (конкретный или «любой») и требуемые ресурсы.
 * Ресурс не может быть использован дважды в пересекающихся интервалах одного визита.
 */
export function findAssignment(
  start: number,
  services: EngineService[],
  resources: EngineResource[],
  items: RequestItem[],
  settings: Pick<EngineSettings, 'multiServiceMode' | 'loadBalancing'>,
): SlotAssignment | null {
  const plans = planItems(services, items, start, settings.multiServiceMode);
  const used: Array<{ resourceId: string; occupancy: Interval }> = [];
  const result: AssignedItem[] = [];
  const extraLoad = new Map<string, number>();
  let steps = 0;

  const free = (r: EngineResource, occ: Interval): boolean =>
    contains(r.available, occ) && !isBusy(r.busy, occ) && !used.some((u) => u.resourceId === r.id && overlaps(u.occupancy, occ));

  const pickResources = (plan: ItemPlan, reqIdx: number, chosen: string[], done: (ids: string[]) => boolean): boolean => {
    if (reqIdx >= plan.service.requirements.length) return done(chosen);
    const req = plan.service.requirements[reqIdx]!;
    const quantity = req.quantity * plan.seats;
    if (plan.together && quantity > 1) {
      // Места подряд: окно из quantity соседних по порядку ресурсов (с учётом занятых — они разрывают ряд).
      const row = resources
        .filter((r) => r.type === req.resourceType && r.serviceIds.has(plan.service.id))
        .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (let i = 0; i + quantity <= row.length; i++) {
        if (++steps > MAX_SEARCH_STEPS) return false;
        const window = row.slice(i, i + quantity);
        if (window.every((r) => !chosen.includes(r.id) && free(r, plan.occupancy)) && pickResources(plan, reqIdx + 1, [...chosen, ...window.map((r) => r.id)], done)) return true;
      }
      return false;
    }
    const candidates = orderCandidates(
      resources.filter((r) => r.type === req.resourceType && r.serviceIds.has(plan.service.id) && !chosen.includes(r.id) && free(r, plan.occupancy)),
      false,
      extraLoad,
    );
    const choose = (from: number, picked: string[]): boolean => {
      if (++steps > MAX_SEARCH_STEPS) return false;
      if (picked.length === quantity) return pickResources(plan, reqIdx + 1, [...chosen, ...picked], done);
      for (let i = from; i < candidates.length; i++) {
        if (choose(i + 1, [...picked, candidates[i]!.id])) return true;
      }
      return false;
    };
    return choose(0, []);
  };

  const assign = (idx: number): boolean => {
    if (idx >= plans.length) return true;
    if (++steps > MAX_SEARCH_STEPS) return false;
    const plan = plans[idx]!;
    let specialistOptions: Array<EngineResource | null>;
    if (plan.service.requiresSpecialist) {
      const pool = resources.filter(
        (r) =>
          r.type === 'specialist' &&
          r.serviceIds.has(plan.service.id) &&
          (!plan.specialistId || r.specialistId === plan.specialistId) &&
          free(r, plan.occupancy),
      );
      specialistOptions = orderCandidates(pool, settings.loadBalancing, extraLoad);
      if (specialistOptions.length === 0) return false;
    } else {
      specialistOptions = [null];
    }

    for (const sp of specialistOptions) {
      if (sp) {
        used.push({ resourceId: sp.id, occupancy: plan.occupancy });
        extraLoad.set(sp.id, (extraLoad.get(sp.id) ?? 0) + (plan.occupancy.end - plan.occupancy.start) / MIN);
      }
      const ok = pickResources(plan, 0, [], (ids) => {
        for (const id of ids) used.push({ resourceId: id, occupancy: plan.occupancy });
        result.push({
          position: plan.position,
          serviceId: plan.service.id,
          start: plan.start,
          end: plan.end,
          occupancy: plan.occupancy,
          specialistId: sp?.specialistId ?? null,
          specialistResourceId: sp?.id ?? null,
          resourceIds: ids,
          seats: plan.seats,
        });
        if (assign(idx + 1)) return true;
        result.pop();
        used.splice(used.length - ids.length, ids.length);
        return false;
      });
      if (ok) return true;
      if (sp) {
        used.pop();
        extraLoad.set(sp.id, (extraLoad.get(sp.id) ?? 0) - (plan.occupancy.end - plan.occupancy.start) / MIN);
      }
    }
    return false;
  };

  if (!assign(0)) return null;
  const end = Math.max(...result.map((r) => r.end));
  return { start, end, items: [...result].sort((a, b) => a.position - b.position) };
}

/** Кандидаты времени начала: шаг slotInterval от локальной полуночи в пределах окон филиала. */
export function candidateStarts(branchWindows: Interval[], date: string, timezone: string, settings: EngineSettings): number[] {
  const midnight = localMidnight(date, timezone).toMillis();
  const step = settings.slotIntervalMinutes * MIN;
  const out: number[] = [];
  for (const w of normalize(branchWindows)) {
    let t = midnight + Math.ceil((w.start - midnight) / step) * step;
    for (; t < w.end; t += step) {
      if (t >= settings.earliestStart && t <= settings.latestStart) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Все доступные слоты на дату. */
export function computeSlots(args: {
  date: string;
  timezone: string;
  branchWindows: Interval[];
  services: EngineService[];
  resources: EngineResource[];
  items: RequestItem[];
  settings: EngineSettings;
}): SlotAssignment[] {
  const slots: SlotAssignment[] = [];
  for (const start of candidateStarts(args.branchWindows, args.date, args.timezone, args.settings)) {
    const a = findAssignment(start, args.services, args.resources, args.items, args.settings);
    if (a) slots.push(a);
  }
  return slots;
}

/** Итоговая продолжительность визита в минутах (без буферов) — для отображения. */
export function visitDurationMinutes(services: EngineService[], items: RequestItem[], mode: 'sequential' | 'parallel'): number {
  const plans = planItems(services, items, 0, mode);
  return (Math.max(...plans.map((p) => p.end)) - Math.min(...plans.map((p) => p.start))) / MIN;
}
