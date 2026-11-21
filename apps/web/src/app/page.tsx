import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight, BarChart3, CalendarCheck2, CalendarDays, Hourglass, MessageCircle, Palette, RefreshCcw, ShieldCheck, Smartphone, Sparkles,
  type LucideIcon,
} from 'lucide-react';

const FEATURES: Array<[LucideIcon, string, string, string]> = [
  [CalendarCheck2, 'bg-indigo-50 text-indigo-600', 'Онлайн-запись 24/7', 'Клиент выбирает услугу, мастера или место и время, подтверждает номер кодом. Двойная запись на одно время невозможна.'],
  [RefreshCcw, 'bg-sky-50 text-sky-600', 'Перенос и отмена', 'Клиент сам переносит или отменяет запись по ссылке из сообщения или в личном кабинете — в пределах ваших правил.'],
  [Hourglass, 'bg-amber-50 text-amber-600', 'Лист ожидания', 'Когда кто-то отменяет запись, освободившееся время автоматически предлагается клиентам из очереди.'],
  [MessageCircle, 'bg-emerald-50 text-emerald-600', 'Уведомления в WhatsApp', 'Подтверждения, напоминания, переносы и запросы отзывов через официальный WhatsApp Business Platform.'],
  [CalendarDays, 'bg-rose-50 text-rose-600', 'График смен', 'Кто работает завтра и на месяц вперёд. Убираете мастера со смены — система сразу покажет его записи.'],
  [BarChart3, 'bg-violet-50 text-violet-600', 'Статистика', 'Просмотры, записи, конверсия, источники трафика по UTM-меткам, популярные услуги и мастера.'],
];

const CATEGORIES = ['Салоны красоты', 'Барбершопы', 'Массаж', 'Косметология', 'Бани и сауны', 'Компьютерные клубы', 'Автомойки', 'Детейлинг', 'Автосервисы'];

const SHOWCASE: Array<[string, string, string]> = [
  ['/landing/salon-desktop.webp', 'Модерн', 'Салон красоты: услуги, мастера, акции и запись в два касания.'],
  ['/landing/club-desktop.webp', 'Неон', 'Компьютерный клуб: залы, ПК и PlayStation с ценами за час.'],
  ['/landing/sauna-desktop.webp', 'Тепло', 'Банный комплекс: сауна, баня и хаммам — бронь зала онлайн.'],
];

const STEPS: Array<[string, string]> = [
  ['Подключение', 'Администратор платформы создаёт вашу организацию, филиалы и доступ владельца.'],
  ['Настройка', 'Вы добавляете услуги, мастеров, залы или места, график смен и правила записи.'],
  ['Оформление', 'Выбираете тему в магазине оформлений, загружаете фото и публикуете страницу.'],
  ['Запись', 'Делитесь ссылкой в Instagram, WhatsApp и 2GIS — клиенты записываются сами.'],
];

/** Окно браузера вокруг скриншота страницы. */
function BrowserFrame({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
      </div>
      <img src={src} alt={alt} width={1280} height={800} className="block h-auto w-full" />
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      {subtitle && <p className="mt-2 max-w-2xl text-slate-600">{subtitle}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** Главная страница платформы. Публичной регистрации организаций нет (ТЗ §2.2): подключение — через администратора. */
export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[1100px] -translate-x-1/2 rounded-full bg-gradient-to-br from-indigo-200/60 via-violet-100/50 to-amber-100/60 blur-3xl" />
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 whitespace-nowrap font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
              <CalendarCheck2 className="h-5 w-5" />
            </span>
            <span className="hidden sm:inline">Онлайн-запись</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/ru/cabinet" className="whitespace-nowrap rounded-lg px-3 py-2 text-slate-700 hover:bg-white/70">Мои записи</Link>
            <Link href="/login" className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800">Вход для бизнеса</Link>
          </nav>
        </header>

        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-3 py-1 text-xs font-medium text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" /> Новые темы оформления каждый месяц
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Онлайн-запись для сервисного бизнеса в&nbsp;Казахстане
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              Красивая страница филиала, запись без звонков, напоминания в WhatsApp и удобный кабинет для владельца и администраторов.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700">
                Войти в кабинет бизнеса <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/ru/cabinet" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:border-brand-500">Личный кабинет клиента</Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2 text-sm text-slate-600">
              {CATEGORIES.map((c) => (
                <li key={c} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">{c}</li>
              ))}
            </ul>
          </div>
          <div className="relative pb-16 lg:pb-0">
            <BrowserFrame src="/landing/club-desktop.webp" alt="Страница компьютерного клуба в теме «Неон»" className="rotate-1" />
            <div className="absolute -bottom-4 right-2 w-[30%] max-w-[180px] -rotate-2 overflow-hidden rounded-[1.6rem] border-[6px] border-slate-900 bg-white shadow-2xl sm:right-6 lg:-bottom-24 lg:-right-4">
              <img src="/landing/sauna-mobile-book.webp" alt="Онлайн-запись с телефона" width={412} height={839} className="block h-auto w-full" />
            </div>
          </div>
        </section>
      </div>

      <Section title="Всё для записи клиентов" subtitle="Одна система вместо тетради, звонков и переписки в мессенджерах.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([Icon, tone, title, text]) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-slate-900/5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="bg-slate-50 pt-16">
        <Section title="Оформление под ваш бизнес" subtitle="Магазин оформлений: выберите тему и цветовую схему, посмотрите свою страницу в ней и примените в один клик.">
          <div className="grid gap-6 md:grid-cols-3">
            {SHOWCASE.map(([src, name, text]) => (
              <figure key={src}>
                <BrowserFrame src={src} alt={`Тема «${name}»`} />
                <figcaption className="mt-4">
                  <span className="inline-flex items-center gap-1.5 font-semibold"><Palette className="h-4 w-4 text-brand-600" /> {name}</span>
                  <p className="mt-1 text-sm text-slate-600">{text}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      </div>

      <div className="pt-16">
        <Section title="Как начать">
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="relative rounded-2xl border border-slate-200 bg-white p-6">
                <span className="text-4xl font-bold text-brand-100">0{i + 1}</span>
                <h3 className="mt-2 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-start gap-2 text-sm text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Самостоятельной регистрации организаций нет: чтобы подключить бизнес, обратитесь к администратору платформы. Оплата подписки — вне сайта.
          </p>
        </Section>
      </div>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-600 to-violet-700 p-8 text-white sm:p-12">
          <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
          <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl"><Smartphone className="h-7 w-7" /> Вы клиент?</h2>
              <p className="mt-3 max-w-2xl text-white/90">
                Записывайтесь по ссылке заведения. Все ваши записи во всех заведениях — в личном кабинете: вход по номеру телефона и коду, без пароля.
              </p>
            </div>
            <Link href="/ru/cabinet" className="inline-flex items-center gap-2 justify-self-start rounded-xl bg-white px-5 py-3 font-semibold text-brand-700 hover:bg-indigo-50">
              Открыть мои записи <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        <Link href="/legal/privacy" className="underline">Политика конфиденциальности</Link> ·{' '}
        <Link href="/legal/terms" className="underline">Пользовательское соглашение</Link> ·{' '}
        <Link href="/legal/processing" className="underline">Обработка персональных данных</Link>
      </footer>
    </main>
  );
}
