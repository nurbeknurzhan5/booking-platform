import {
  candidateStarts,
  computeSlots,
  dayWindows,
  findAssignment,
  intersect,
  normalize,
  subtract,
  visitDurationMinutes,
  type EngineResource,
  type EngineService,
  type EngineSettings,
  type ScheduleSource,
} from './engine';

const TZ = 'Asia/Almaty'; // UTC+5
const DATE = '2026-12-07'; // понедельник
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+05:00`).getTime();
const iv = (a: string, b: string) => ({ start: at(a), end: at(b) });
const fmt = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(11, 16);

const weekly = (start: number, end: number): ScheduleSource => ({
  hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start, end })),
  breaks: [],
  exceptions: [],
});

function svc(id: string, duration: number, extra: Partial<EngineService> = {}): EngineService {
  return { id, name: id, durationMinutes: duration, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, requiresSpecialist: true, requirements: [], ...extra };
}

function res(id: string, type: string, services: string[], extra: Partial<EngineResource> = {}): EngineResource {
  return {
    id,
    type,
    specialistId: type === 'specialist' ? `sp-${id}` : null,
    name: id,
    sortOrder: 0,
    serviceIds: new Set(services),
    available: [iv('10:00', '20:00')],
    busy: [],
    loadMinutes: 0,
    ...extra,
  };
}

const settings: EngineSettings = {
  slotIntervalMinutes: 30,
  multiServiceMode: 'sequential',
  loadBalancing: true,
  earliestStart: 0,
  latestStart: Number.MAX_SAFE_INTEGER,
};

describe('интервалы', () => {
  it('normalize/intersect/subtract', () => {
    expect(normalize([iv('12:00', '13:00'), iv('10:00', '12:30')])).toEqual([iv('10:00', '13:00')]);
    expect(intersect([iv('10:00', '14:00')], [iv('12:00', '16:00')])).toEqual([iv('12:00', '14:00')]);
    expect(subtract([iv('10:00', '18:00')], [iv('13:00', '14:00')])).toEqual([iv('10:00', '13:00'), iv('14:00', '18:00')]);
    expect(subtract([iv('10:00', '11:00')], [iv('09:00', '12:00')])).toEqual([]);
  });
});

describe('расписание на дату (часовой пояс филиала)', () => {
  it('рабочие часы переводятся из локального времени в UTC', () => {
    const w = dayWindows(weekly(600, 1200), DATE, TZ);
    expect(w).toEqual([iv('10:00', '20:00')]);
    expect(new Date(w[0]!.start).toISOString()).toBe('2026-12-07T05:00:00.000Z');
  });

  it('перерывы вычитаются, выходной — пусто, особые часы заменяют недельные', () => {
    const src: ScheduleSource = { ...weekly(600, 1200), breaks: [{ weekday: 1, start: 780, end: 840 }] };
    expect(dayWindows(src, DATE, TZ)).toEqual([iv('10:00', '13:00'), iv('14:00', '20:00')]);
    const closed: ScheduleSource = { ...src, exceptions: [{ dateFrom: '2026-12-01', dateTo: '2026-12-10', kind: 'closed', intervals: [] }] };
    expect(dayWindows(closed, DATE, TZ)).toEqual([]);
    const custom: ScheduleSource = {
      ...weekly(600, 1200),
      exceptions: [{ dateFrom: DATE, dateTo: DATE, kind: 'custom_hours', intervals: [{ start: 720, end: 900 }] }],
    };
    expect(dayWindows(custom, DATE, TZ)).toEqual([iv('12:00', '15:00')]);
  });

  it('выходной день недели без интервалов', () => {
    const src: ScheduleSource = { hours: [{ weekday: 2, start: 600, end: 1200 }], breaks: [], exceptions: [] };
    expect(dayWindows(src, DATE, TZ)).toEqual([]);
  });

  it('ресурс без своего расписания наследует расписание филиала', () => {
    const empty: ScheduleSource = { hours: [], breaks: [], exceptions: [] };
    expect(dayWindows(empty, DATE, TZ, [iv('10:00', '18:00')])).toEqual([iv('10:00', '18:00')]);
  });
});

describe('кандидаты времени', () => {
  it('выравнивание по шагу и ограничения минимального срока/горизонта', () => {
    const c = candidateStarts([iv('10:10', '12:00')], DATE, TZ, { ...settings, earliestStart: at('11:00') });
    expect(c.map(fmt)).toEqual(['11:00', '11:30']);
    const c2 = candidateStarts([iv('10:00', '12:00')], DATE, TZ, { ...settings, latestStart: at('10:30') });
    expect(c2.map(fmt)).toEqual(['10:00', '10:30']);
  });
});

describe('назначение ресурсов', () => {
  const haircut = svc('haircut', 60);

  it('занятый специалист исключает слот; слот не выходит за рабочее время', () => {
    // Окна ресурса уже пересечены с окнами филиала (это делает загрузчик).
    const anna = res('anna', 'specialist', ['haircut'], { available: [iv('10:00', '13:00')], busy: [iv('11:00', '12:00')] });
    const slots = computeSlots({ date: DATE, timezone: TZ, branchWindows: [iv('10:00', '13:00')], services: [haircut], resources: [anna], items: [{ serviceId: 'haircut' }], settings });
    // 10:30 пересекает занятость, 12:30 закончилась бы после закрытия
    expect(slots.map((s) => fmt(s.start))).toEqual(['10:00', '12:00']);
  });

  it('буферы до/после блокируют занятость', () => {
    const s = svc('wash', 30, { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
    const r = res('post1', 'specialist', ['wash'], { busy: [iv('11:00', '11:30')] });
    const a = findAssignment(at('10:30'), [s], [r], [{ serviceId: 'wash' }], settings);
    expect(a).toBeNull(); // занятость 10:15–11:15 пересекает 11:00
    const b = findAssignment(at('11:45'), [s], [r], [{ serviceId: 'wash' }], settings);
    expect(b?.items[0]!.occupancy).toEqual(iv('11:30', '12:30'));
    expect(findAssignment(at('10:00'), [s], [r], [{ serviceId: 'wash' }], settings)).toBeNull(); // буфер до 10:00 вне окна
  });

  it('нет свободного обязательного кабинета — слот не показывается (§7)', () => {
    const massage = svc('massage', 60, { requirements: [{ resourceType: 'cabinet', quantity: 1 }] });
    const ivan = res('ivan', 'specialist', ['massage']);
    const cab = res('cab1', 'cabinet', ['massage'], { busy: [iv('10:00', '11:00')] });
    expect(findAssignment(at('10:00'), [massage], [ivan, cab], [{ serviceId: 'massage' }], settings)).toBeNull();
    const ok = findAssignment(at('11:00'), [massage], [ivan, cab], [{ serviceId: 'massage' }], settings);
    expect(ok?.items[0]).toMatchObject({ specialistResourceId: 'ivan', resourceIds: ['cab1'] });
  });

  it('кабинет, не поддерживающий услугу, не используется', () => {
    const massage = svc('massage', 60, { requirements: [{ resourceType: 'cabinet', quantity: 1 }] });
    const ivan = res('ivan', 'specialist', ['massage']);
    const cab = res('cab1', 'cabinet', ['other']);
    expect(findAssignment(at('10:00'), [massage], [ivan, cab], [{ serviceId: 'massage' }], settings)).toBeNull();
  });

  it('услуга без специалиста (баня/зал) требует только ресурс', () => {
    const sauna = svc('sauna', 120, { requiresSpecialist: false, requirements: [{ resourceType: 'hall', quantity: 1 }] });
    const hall = res('hall1', 'hall', ['sauna']);
    const a = findAssignment(at('10:00'), [sauna], [hall], [{ serviceId: 'sauna' }], settings);
    expect(a?.items[0]).toMatchObject({ specialistResourceId: null, resourceIds: ['hall1'] });
  });

  it('автоподбор: наименее загруженный специалист, детерминированно', () => {
    const a = res('a', 'specialist', ['haircut'], { loadMinutes: 120, sortOrder: 0 });
    const b = res('b', 'specialist', ['haircut'], { loadMinutes: 30, sortOrder: 1 });
    const c = res('c', 'specialist', ['haircut'], { loadMinutes: 30, sortOrder: 2 });
    const r1 = findAssignment(at('10:00'), [haircut], [a, b, c], [{ serviceId: 'haircut' }], settings);
    expect(r1?.items[0]!.specialistResourceId).toBe('b');
    const r2 = findAssignment(at('10:00'), [haircut], [c, b, a], [{ serviceId: 'haircut' }], settings);
    expect(r2?.items[0]!.specialistResourceId).toBe('b'); // порядок входа не влияет
    const r3 = findAssignment(at('10:00'), [haircut], [a, b, c], [{ serviceId: 'haircut' }], { ...settings, loadBalancing: false });
    expect(r3?.items[0]!.specialistResourceId).toBe('a');
  });

  it('конкретный специалист по запросу клиента', () => {
    const a = res('a', 'specialist', ['haircut']);
    const b = res('b', 'specialist', ['haircut'], { busy: [iv('10:00', '11:00')] });
    expect(findAssignment(at('10:00'), [haircut], [a, b], [{ serviceId: 'haircut', specialistId: 'sp-b' }], settings)).toBeNull();
    expect(findAssignment(at('11:00'), [haircut], [a, b], [{ serviceId: 'haircut', specialistId: 'sp-b' }], settings)?.items[0]!.specialistId).toBe('sp-b');
  });

  it('несколько услуг последовательно: один мастер на обе или разные мастера', () => {
    const color = svc('color', 90);
    const one = res('one', 'specialist', ['haircut', 'color']);
    const a = findAssignment(at('10:00'), [haircut, color], [one], [{ serviceId: 'haircut' }, { serviceId: 'color' }], settings);
    expect(a?.items.map((i) => [fmt(i.start), fmt(i.end), i.specialistResourceId])).toEqual([
      ['10:00', '11:00', 'one'],
      ['11:00', '12:30', 'one'],
    ]);
    expect(visitDurationMinutes([haircut, color], [{ serviceId: 'haircut' }, { serviceId: 'color' }], 'sequential')).toBe(150);

    const cutter = res('cutter', 'specialist', ['haircut']);
    const colorist = res('colorist', 'specialist', ['color'], { busy: [iv('11:00', '11:30')] });
    expect(findAssignment(at('10:00'), [haircut, color], [cutter, colorist], [{ serviceId: 'haircut' }, { serviceId: 'color' }], settings)).toBeNull();
    const b = findAssignment(at('10:30'), [haircut, color], [cutter, colorist], [{ serviceId: 'haircut' }, { serviceId: 'color' }], settings);
    expect(b?.items.map((i) => i.specialistResourceId)).toEqual(['cutter', 'colorist']);
  });

  it('параллельный режим: разные исполнители одновременно, один мастер не может делать две услуги сразу', () => {
    const manicure = svc('manicure', 60);
    const pedicure = svc('pedicure', 60);
    const m1 = res('m1', 'specialist', ['manicure', 'pedicure']);
    const m2 = res('m2', 'specialist', ['manicure', 'pedicure']);
    const p = { ...settings, multiServiceMode: 'parallel' as const };
    const a = findAssignment(at('10:00'), [manicure, pedicure], [m1, m2], [{ serviceId: 'manicure' }, { serviceId: 'pedicure' }], p);
    expect(new Set(a?.items.map((i) => i.specialistResourceId)).size).toBe(2);
    expect(a?.end).toBe(at('11:00'));
    expect(findAssignment(at('10:00'), [manicure, pedicure], [m1], [{ serviceId: 'manicure' }, { serviceId: 'pedicure' }], p)).toBeNull();
  });

  it('возврат (backtracking): автоподбор не блокирует нужного мастера для второй услуги', () => {
    const color = svc('color', 60);
    // a умеет только стрижку; b умеет обе. Если на стрижку поставить b, на окрашивание никого не останется (параллельный режим).
    const a = res('a', 'specialist', ['haircut'], { loadMinutes: 500 });
    const b = res('b', 'specialist', ['haircut', 'color'], { loadMinutes: 0 });
    const p = { ...settings, multiServiceMode: 'parallel' as const };
    const r = findAssignment(at('10:00'), [haircut, color], [a, b], [{ serviceId: 'haircut' }, { serviceId: 'color' }], p);
    expect(r?.items.map((i) => i.specialistResourceId)).toEqual(['a', 'b']);
  });

  it('несколько единиц ресурса (quantity = 2)', () => {
    const big = svc('big', 60, { requiresSpecialist: false, requirements: [{ resourceType: 'equipment', quantity: 2 }] });
    const e1 = res('e1', 'equipment', ['big']);
    const e2 = res('e2', 'equipment', ['big'], { busy: [iv('10:00', '11:00')] });
    const e3 = res('e3', 'equipment', ['big']);
    const r = findAssignment(at('10:00'), [big], [e1, e2, e3], [{ serviceId: 'big' }], settings);
    expect(r?.items[0]!.resourceIds.sort()).toEqual(['e1', 'e3']);
  });
});
