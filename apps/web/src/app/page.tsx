import Link from 'next/link';

const FEATURES: Array<[string, string, string]> = [
  ['📅', 'Онлайн-запись 24/7', 'Клиент выбирает услугу, мастера и время, подтверждает номер кодом. Двойная запись на одно время невозможна.'],
  ['🔁', 'Перенос и отмена', 'Клиент сам переносит или отменяет запись по ссылке из сообщения или в личном кабинете — в пределах ваших правил.'],
  ['⏳', 'Лист ожидания', 'Когда кто-то отменяет запись, освободившееся время автоматически предлагается клиентам из очереди.'],
  ['💬', 'Уведомления в WhatsApp', 'Подтверждения, напоминания, переносы и запросы отзывов через официальный WhatsApp Business Platform.'],
  ['🌐', 'Страница филиала', 'Готовые шаблоны, постоянная ссылка, русский, казахский и английский языки, карта 2GIS, отзывы и акции.'],
  ['📊', 'Статистика', 'Просмотры, записи, конверсия, источники трафика по UTM-меткам, популярные услуги и мастера.'],
];

const CATEGORIES = ['Салоны красоты', 'Барбершопы', 'Массаж', 'Косметология', 'Бани и сауны', 'Автомойки', 'Детейлинг', 'Автосервисы'];

const STEPS: Array<[string, string]> = [
  ['Подключение', 'Администратор платформы создаёт вашу организацию, филиалы и доступ владельца.'],
  ['Настройка', 'Вы добавляете услуги, мастеров, кабинеты или посты, расписание и правила записи.'],
  ['Страница', 'Выбираете шаблон, загружаете фото и публикуете страницу филиала.'],
  ['Запись', 'Делитесь ссылкой в Instagram, WhatsApp и 2GIS — клиенты записываются сами.'],
];

/** Главная страница платформы. Публичной регистрации организаций нет (ТЗ §2.2): подключение — через администратора. */
export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="font-semibold">Онлайн-запись</span>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/ru/cabinet" className="rounded-lg px-3 py-2 text-slate-700 hover:bg-white">Мои записи</Link>
          <Link href="/login" className="rounded-lg bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700">Вход для бизнеса</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-16">
        <h1 className="max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">Онлайн-запись для сервисного бизнеса в Казахстане</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">
          Страница филиала, запись без звонков, напоминания в WhatsApp и кабинет для владельца и администраторов — в одной системе.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-brand-700">Войти в кабинет бизнеса</Link>
          <Link href="/ru/cabinet" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold hover:border-brand-500">Личный кабинет клиента</Link>
        </div>
        <ul className="mt-8 flex flex-wrap gap-2 text-sm text-slate-600">
          {CATEGORIES.map((c) => (
            <li key={c} className="rounded-full border border-slate-200 bg-white px-3 py-1">{c}</li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <h2 className="mb-5 text-2xl font-bold">Возможности</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-2xl" aria-hidden>{icon}</div>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <h2 className="mb-5 text-2xl font-bold">Как начать</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm text-slate-600">
          Самостоятельной регистрации организаций нет: чтобы подключить бизнес, обратитесь к администратору платформы. Оплата подписки — вне сайта.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-2xl bg-brand-600 p-6 text-white sm:p-8">
          <h2 className="text-xl font-bold sm:text-2xl">Вы клиент?</h2>
          <p className="mt-2 max-w-2xl text-white/90">
            Записывайтесь по ссылке заведения. Все ваши записи во всех заведениях — в личном кабинете: вход по номеру телефона и коду, без пароля.
          </p>
          <Link href="/ru/cabinet" className="mt-4 inline-block rounded-xl bg-white px-5 py-3 font-semibold text-brand-700">Открыть мои записи</Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <Link href="/legal/privacy" className="underline">Политика конфиденциальности</Link> ·{' '}
        <Link href="/legal/terms" className="underline">Пользовательское соглашение</Link> ·{' '}
        <Link href="/legal/processing" className="underline">Обработка персональных данных</Link>
      </footer>
    </main>
  );
}
