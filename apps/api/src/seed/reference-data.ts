import { BRANCH_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ORG_PERMISSIONS, type TemplateConfig } from '@booking/shared';
import type { PrismaClient } from '../generated/prisma/client';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'appointments.view': 'Просмотр записей филиала',
  'appointments.manage': 'Управление записями (создание, отмена, выполнение, перенос)',
  'clients.view': 'Просмотр клиентов',
  'services.manage': 'Управление услугами',
  'specialists.manage': 'Управление специалистами',
  'resources.manage': 'Управление ресурсами',
  'schedules.manage': 'Управление расписаниями',
  'reviews.manage': 'Ответы на отзывы',
  'analytics.view': 'Статистика филиала',
  'pages.edit': 'Редактирование публичной страницы',
  'branch.settings.manage': 'Настройки филиала',
  'org.manage': 'Управление организацией',
  'branches.manage': 'Создание и архивирование филиалов',
  'users.manage': 'Управление сотрудниками и правами',
  'promotions.manage': 'Промокоды и акции',
  'booking_settings.manage': 'Правила бронирования',
  'notifications.manage': 'Настройки уведомлений',
  'integrations.manage': 'Интеграции',
  'audit.view': 'Журнал действий',
  'subscription.view': 'Просмотр подписки',
};

export const BUSINESS_CATEGORIES = [
  ['beauty_salon', 'Салон красоты', 'Сұлулық салоны', 'Beauty salon'],
  ['barbershop', 'Барбершоп', 'Барбершоп', 'Barbershop'],
  ['massage', 'Массажный кабинет', 'Массаж кабинеті', 'Massage'],
  ['cosmetology', 'Косметологический центр', 'Косметология орталығы', 'Cosmetology'],
  ['wellness', 'Оздоровительный центр', 'Сауықтыру орталығы', 'Wellness center'],
  ['bath_sauna', 'Баня и сауна', 'Монша және сауна', 'Bath & sauna'],
  ['car_wash', 'Автомойка', 'Көлік жуу', 'Car wash'],
  ['detailing', 'Детейлинг-центр', 'Детейлинг орталығы', 'Detailing'],
  ['car_service', 'Автосервис', 'Автосервис', 'Car service'],
  ['computer_club', 'Компьютерный клуб', 'Компьютерлік клуб', 'Computer club'],
  ['other', 'Другое', 'Басқа', 'Other'],
] as const;

/**
 * meta — имя одобренного шаблона Meta. null — обычный текст (category SERVICE): разрешён только как ответ
 * в 24-часовом окне после сообщения клиента (D-32).
 */
type Tpl = { type: string; category: string; meta: string | null; vars: string[]; ru: string; kk: string; en: string };
export const NOTIFICATION_TEMPLATES: Tpl[] = [
  {
    type: 'otp',
    category: 'AUTHENTICATION',
    meta: 'otp_code',
    vars: ['code'],
    ru: 'Код подтверждения: {{code}}. Действует {{minutes}} мин. Никому не сообщайте код.',
    kk: 'Растау коды: {{code}}. {{minutes}} мин жарамды. Кодты ешкімге айтпаңыз.',
    en: 'Your verification code: {{code}}. Valid for {{minutes}} min. Do not share it.',
  },
  {
    type: 'appointment_confirmed',
    category: 'UTILITY',
    meta: 'appointment_confirmed',
    vars: ['clientName', 'branchName', 'date', 'time', 'manageUrl'],
    ru: '{{clientName}}, вы записаны в «{{branchName}}» на {{date}} в {{time}}. Услуги: {{services}}. Сумма: {{total}} ₸. Управление записью: {{manageUrl}}',
    kk: '{{clientName}}, сіз «{{branchName}}» мекемесіне {{date}} {{time}} уақытына жазылдыңыз. Қызметтер: {{services}}. Сомасы: {{total}} ₸. Жазбаны басқару: {{manageUrl}}',
    en: '{{clientName}}, you are booked at "{{branchName}}" on {{date}} at {{time}}. Services: {{services}}. Total: {{total}} KZT. Manage: {{manageUrl}}',
  },
  {
    type: 'appointment_reminder',
    category: 'UTILITY',
    meta: 'appointment_reminder',
    vars: ['clientName', 'branchName', 'date', 'time', 'manageUrl'],
    ru: 'Напоминаем: {{date}} в {{time}} вас ждут в «{{branchName}}». Изменить запись: {{manageUrl}}',
    kk: 'Еске саламыз: {{date}} {{time}} «{{branchName}}» сізді күтеді. Жазбаны өзгерту: {{manageUrl}}',
    en: 'Reminder: {{date}} at {{time}} at "{{branchName}}". Manage: {{manageUrl}}',
  },
  {
    type: 'appointment_rescheduled',
    category: 'UTILITY',
    meta: 'appointment_rescheduled',
    vars: ['clientName', 'branchName', 'date', 'time', 'manageUrl'],
    ru: 'Запись в «{{branchName}}» перенесена на {{date}} в {{time}}. Подробнее: {{manageUrl}}',
    kk: '«{{branchName}}» жазбасы {{date}} {{time}} уақытына ауыстырылды. Толығырақ: {{manageUrl}}',
    en: 'Your booking at "{{branchName}}" was moved to {{date}} at {{time}}. Details: {{manageUrl}}',
  },
  {
    type: 'appointment_cancelled',
    category: 'UTILITY',
    meta: 'appointment_cancelled',
    vars: ['clientName', 'branchName', 'date', 'time'],
    ru: 'Запись в «{{branchName}}» на {{date}} в {{time}} отменена.',
    kk: '«{{branchName}}» мекемесіндегі {{date}} {{time}} жазбасы тоқтатылды.',
    en: 'Your booking at "{{branchName}}" on {{date}} at {{time}} was cancelled.',
  },
  {
    type: 'appointment_completed',
    category: 'UTILITY',
    meta: 'appointment_completed',
    vars: ['clientName', 'branchName'],
    ru: 'Спасибо за визит в «{{branchName}}»! Будем рады видеть вас снова.',
    kk: '«{{branchName}}» мекемесіне келгеніңізге рахмет! Сізді қайта күтеміз.',
    en: 'Thank you for visiting "{{branchName}}"! See you again.',
  },
  {
    type: 'review_request',
    category: 'UTILITY',
    meta: 'review_request',
    vars: ['clientName', 'branchName', 'reviewUrl'],
    ru: 'Оцените визит в «{{branchName}}»: {{reviewUrl}}',
    kk: '«{{branchName}}» сапарын бағалаңыз: {{reviewUrl}}',
    en: 'Rate your visit to "{{branchName}}": {{reviewUrl}}',
  },
  {
    type: 'waitlist_offer',
    category: 'UTILITY',
    meta: 'waitlist_offer',
    vars: ['branchName', 'date', 'time', 'offerUrl'],
    ru: 'Освободилось время в «{{branchName}}»: {{date}} в {{time}}. Забронировать: {{offerUrl}}',
    kk: '«{{branchName}}» мекемесінде уақыт босады: {{date}} {{time}}. Брондау: {{offerUrl}}',
    en: 'A slot opened at "{{branchName}}": {{date}} at {{time}}. Book: {{offerUrl}}',
  },
  {
    type: 'reactivation',
    category: 'MARKETING',
    meta: 'reactivation',
    vars: ['clientName', 'branchName', 'bookingUrl'],
    ru: '{{clientName}}, давно не виделись! «{{branchName}}» будет рад видеть вас снова. Записаться: {{bookingUrl}}. Чтобы не получать такие сообщения, ответьте СТОП.',
    kk: '{{clientName}}, көптен бері көрінбедіңіз! «{{branchName}}» сізді қайта күтеді. Жазылу: {{bookingUrl}}. Мұндай хабарламаларды алмау үшін ТОҚТАТУ деп жауап беріңіз.',
    en: '{{clientName}}, we miss you! "{{branchName}}" would love to see you again. Book: {{bookingUrl}}. Reply STOP to unsubscribe.',
  },
  {
    type: 'whatsapp_auto_reply',
    category: 'SERVICE',
    meta: null,
    vars: [],
    ru: '{{summary}}\n\nУправление записями: {{cabinetUrl}}\nЭто автоматический ответ: сообщения здесь не читают. По другим вопросам позвоните в филиал.',
    kk: '{{summary}}\n\nЖазбаларды басқару: {{cabinetUrl}}\nБұл автоматты жауап: мұндағы хабарламалар оқылмайды. Басқа сұрақтар бойынша филиалға қоңырау шалыңыз.',
    en: '{{summary}}\n\nManage your bookings: {{cabinetUrl}}\nThis is an automatic reply: messages here are not read. For other questions, please call the branch.',
  },
  {
    type: 'marketing_unsubscribed',
    category: 'SERVICE',
    meta: null,
    vars: [],
    ru: 'Вы отписались от рекламных сообщений. Уведомления о ваших записях будут приходить как прежде.',
    kk: 'Сіз жарнамалық хабарламалардан бас тарттыңыз. Жазбаларыңыз туралы хабарламалар бұрынғыдай келеді.',
    en: 'You have unsubscribed from promotional messages. Notifications about your bookings will continue as before.',
  },
];

const SCHEMES = {
  classic: [
    { key: 'ivory', name: 'Слоновая кость', primary: '#8a5a44', accent: '#c89b7b', background: '#fbf8f4', surface: '#ffffff', text: '#2b2118' },
    { key: 'forest', name: 'Лес', primary: '#2f5d50', accent: '#a3c4bc', background: '#f6faf8', surface: '#ffffff', text: '#1b2a26' },
  ],
  modern: [
    { key: 'indigo', name: 'Индиго', primary: '#4338ca', accent: '#f59e0b', background: '#f8fafc', surface: '#ffffff', text: '#0f172a' },
    { key: 'rose', name: 'Роза', primary: '#be185d', accent: '#fb7185', background: '#fff7fa', surface: '#ffffff', text: '#281018' },
    { key: 'graphite', name: 'Графит', primary: '#111827', accent: '#10b981', background: '#f3f4f6', surface: '#ffffff', text: '#111827' },
  ],
  minimal: [
    { key: 'mono', name: 'Монохром', primary: '#111111', accent: '#666666', background: '#ffffff', surface: '#fafafa', text: '#111111' },
    { key: 'sand', name: 'Песок', primary: '#7c6f57', accent: '#d6ccb8', background: '#fdfcf9', surface: '#ffffff', text: '#2d2a24' },
  ],
  bold: [
    { key: 'night', name: 'Ночь', primary: '#facc15', accent: '#38bdf8', background: '#0b1120', surface: '#111a2e', text: '#f8fafc' },
    { key: 'racing', name: 'Гоночный', primary: '#dc2626', accent: '#f97316', background: '#0a0a0a', surface: '#171717', text: '#fafafa' },
  ],
} as const;

export const PAGE_TEMPLATES: Array<{ key: string; name: string; description: string; config: TemplateConfig }> = [
  {
    key: 'classic',
    name: 'Классика',
    description: 'Спокойный элегантный шаблон для салонов, массажа и косметологии',
    config: {
      layout: 'classic',
      sectionOrder: ['hero', 'about', 'services', 'specialists', 'promotions', 'gallery', 'reviews', 'schedule', 'contacts', 'map', 'socials'],
      colorSchemes: [...SCHEMES.classic],
      bookingButtonPositions: ['header', 'floating', 'after_services'],
    },
  },
  {
    key: 'modern',
    name: 'Модерн',
    description: 'Яркий современный шаблон с акцентом на услуги и акции',
    config: {
      layout: 'modern',
      sectionOrder: ['hero', 'promotions', 'services', 'specialists', 'about', 'gallery', 'reviews', 'schedule', 'contacts', 'map', 'socials'],
      colorSchemes: [...SCHEMES.modern],
      bookingButtonPositions: ['floating', 'header', 'after_services', 'bottom'],
    },
  },
  {
    key: 'minimal',
    name: 'Минимализм',
    description: 'Лаконичный шаблон: главное — список услуг и кнопка записи',
    config: {
      layout: 'minimal',
      sectionOrder: ['hero', 'services', 'specialists', 'schedule', 'contacts', 'map', 'reviews', 'about', 'gallery', 'promotions', 'socials'],
      colorSchemes: [...SCHEMES.minimal],
      bookingButtonPositions: ['header', 'bottom'],
    },
  },
  {
    key: 'bold',
    name: 'Драйв',
    description: 'Тёмный контрастный шаблон для барбершопов, автомоек, детейлинга и автосервисов',
    config: {
      layout: 'bold',
      sectionOrder: ['hero', 'services', 'promotions', 'gallery', 'specialists', 'reviews', 'about', 'schedule', 'contacts', 'map', 'socials'],
      colorSchemes: [...SCHEMES.bold],
      bookingButtonPositions: ['floating', 'header', 'bottom'],
    },
  },
];

export const DEFAULT_PLANS = [
  { code: 'start', name: 'Старт', description: '1 филиал', maxBranches: 1, monthlyPrice: 15000 },
  { code: 'business', name: 'Бизнес', description: 'до 3 филиалов', maxBranches: 3, monthlyPrice: 35000 },
  { code: 'network', name: 'Сеть', description: 'до 10 филиалов', maxBranches: 10, monthlyPrice: 90000 },
];

/** Идемпотентная загрузка справочников. */
export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  const roles = [
    ['SUPERADMIN', 'Суперадминистратор'],
    ['OWNER', 'Владелец организации'],
    ['BRANCH_ADMIN', 'Администратор филиала'],
    ['CLIENT', 'Клиент'],
  ];
  for (const [code, name] of roles) {
    await prisma.role.upsert({ where: { code: code! }, create: { code: code!, name: name! }, update: { name: name! } });
  }
  for (const code of [...BRANCH_PERMISSIONS, ...ORG_PERMISSIONS]) {
    const scope = (BRANCH_PERMISSIONS as readonly string[]).includes(code) ? 'branch' : 'org';
    const description = PERMISSION_DESCRIPTIONS[code] ?? code;
    await prisma.permission.upsert({ where: { code }, create: { code, scope, description }, update: { scope, description } });
  }
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleCode_permissionCode: { roleCode: role, permissionCode: p } },
        create: { roleCode: role, permissionCode: p },
        update: {},
      });
    }
  }
  for (const [i, [code, ru, kk, en]] of BUSINESS_CATEGORIES.entries()) {
    await prisma.businessCategory.upsert({
      where: { code },
      create: { code, nameRu: ru, nameKk: kk, nameEn: en, sortOrder: i },
      update: { nameRu: ru, nameKk: kk, nameEn: en },
    });
  }
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({ where: { code: p.code }, create: p, update: {} });
  }
  for (const t of NOTIFICATION_TEMPLATES) {
    for (const channel of ['whatsapp', 'sms', 'dev_inbox'] as const) {
      for (const locale of ['ru', 'kk', 'en'] as const) {
        await prisma.notificationTemplate.upsert({
          where: { type_channel_locale: { type: t.type, channel, locale } },
          create: {
            type: t.type,
            channel,
            locale,
            providerTemplateName: channel === 'whatsapp' ? t.meta : null,
            category: t.category,
            body: t[locale],
            variables: t.vars,
          },
          update: {},
        });
      }
    }
  }
  for (const [i, t] of PAGE_TEMPLATES.entries()) {
    const existing = await prisma.pageTemplate.findUnique({ where: { key: t.key } });
    if (existing) continue;
    const tpl = await prisma.pageTemplate.create({
      data: { key: t.key, name: t.name, description: t.description, status: 'published', sortOrder: i },
    });
    const v = await prisma.pageTemplateVersion.create({ data: { templateId: tpl.id, version: 1, config: t.config } });
    await prisma.pageTemplate.update({ where: { id: tpl.id }, data: { currentVersionId: v.id } });
  }
}
