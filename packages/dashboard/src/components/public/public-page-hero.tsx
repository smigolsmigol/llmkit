export function PublicPageHero({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <header className="mx-auto grid max-w-6xl gap-8 px-6 pb-10 pt-12 md:pt-16 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
      <div>
        <p className="public-kicker">{eyebrow}</p>
        <h1 className="public-page-title mt-4 text-white">{title}</h1>
        <div className="mt-5 max-w-3xl text-base leading-7 text-zinc-400">{description}</div>
      </div>
      {aside ? <div className="lg:pb-1">{aside}</div> : null}
    </header>
  );
}
