export function HomePage() {
  return (
    <section className="page">
      <div className="hero">
        <p className="eyebrow">TrainMind Control Center</p>
        <h1>Startseite</h1>
        <p className="lead">
          Zentrale Ansicht für Setup, Ride-Import und Aktivitäten.
        </p>
      </div>

      <div className="grid">
        <article className="card">
          <h2>Setup</h2>
          <p>Konfiguriere Projektparameter, Provider und Sync-Verhalten.</p>
        </article>
        <article className="card card-highlight">
          <h2>Garmin Sync Queue</h2>
          <p>
            Noch zu ladende Rides (Dummy): <strong>7</strong>
          </p>
        </article>
        <article className="card">
          <h2>Aktivitäten</h2>
          <p>Schneller Einstieg in die Gesamtansicht aller importierten Einträge.</p>
        </article>
      </div>
    </section>
  );
}
