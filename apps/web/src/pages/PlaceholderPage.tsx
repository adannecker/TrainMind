type PlaceholderPageProps = {
  title: string;
  description: string;
  badge?: string;
};

export function PlaceholderPage({ title, description, badge }: PlaceholderPageProps) {
  return (
    <section className="page">
      <div className="hero">
        {badge ? <p className="eyebrow">{badge}</p> : null}
        <h1>{title}</h1>
        <p className="lead">{description}</p>
      </div>
      <article className="card">
        <h2>Dummy-Seite</h2>
        <p>Diese Unterseite ist vorbereitet und kann jetzt mit echten Daten gefüllt werden.</p>
      </article>
    </section>
  );
}
