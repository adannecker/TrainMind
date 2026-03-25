export function ImpressumPage() {
  return (
    <section className="page">
      <div className="card legal-card">
        <p className="eyebrow">Rechtliches</p>
        <h1>Impressum</h1>
        <div className="legal-copy">
          <p>TrainMind ist ein privates, nicht kommerzielles Projekt für den persönlichen Gebrauch.</p>
          <p>Die Inhalte und Funktionen dienen derzeit ausschließlich zu privaten Test-, Analyse- und Organisationszwecken.</p>
          <p><strong>Projekt:</strong> TrainMind</p>
          <p><strong>Website:</strong> trainmind.de</p>
          <p><strong>Kontakt:</strong> no-reply@trainmind.de</p>
          <p>Falls sich die Nutzung künftig über den rein privaten Bereich hinaus entwickelt, werden die rechtlichen Angaben entsprechend ergänzt und aktualisiert.</p>
        </div>
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <section className="page">
      <div className="card legal-card">
        <p className="eyebrow">Rechtliches</p>
        <h1>Datenschutz</h1>
        <div className="legal-copy">
          <p>TrainMind ist ein privates, nicht kommerzielles Projekt für den persönlichen Gebrauch.</p>
          <p>Beim Einsatz der Plattform können personenbezogene Daten verarbeitet werden, insbesondere E-Mail-Adressen, Kontodaten, Login-Informationen, Einladungslinks sowie technische Server-Logs.</p>
          <p>Zusätzlich können vom Nutzer freiwillig Trainings-, Gesundheits-, Gewichts- und Ernährungsdaten innerhalb der Anwendung gespeichert werden.</p>
          <p>Die Verarbeitung erfolgt ausschließlich zum Betrieb und zur Nutzung der Funktionen von TrainMind.</p>
          <p>Die Daten werden auf dem zugehörigen Server verarbeitet und nicht öffentlich angezeigt. Eine Weitergabe an Dritte erfolgt nicht, soweit sie nicht technisch für Hosting oder E-Mail-Versand erforderlich ist.</p>
          <p>Für Einladungen kann ein E-Mail-Versand über die konfigurierte Mail-Infrastruktur von trainmind.de genutzt werden.</p>
          <p>Wenn du Fragen zum Datenschutz in diesem privaten Projekt hast, nutze bitte die hinterlegte Kontaktadresse: no-reply@trainmind.de.</p>
        </div>
      </div>
    </section>
  );
}
