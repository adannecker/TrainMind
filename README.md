# TrainMind

**TrainMind** ist ein Python-Projekt, um FIT-Dateien (z. B. von Rouvy oder Garmin) auszulesen und Trainingsdaten in **CSV** und **JSON** zu exportieren.  
Langfristig soll TrainMind als zentrale Plattform dienen, in der verschiedene Datenquellen (Radfahren, Waagen, Ernährungstracker usw.) integriert werden können.  

---

## 1. 📂 Projektstruktur

TrainMind/
│
├─ .gitignore
├─ README.md
├─ requirements.txt
├─ TrainMind.sln # Visual Studio Solution
│
├─ data/ # Input & Output Daten
│ ├─ rouvy_test.fit # Beispiel-FIT-Datei (nicht im Repo)
│ └─ exports/ # Output: CSV + JSON
│
└─ src/trainmind/ # Python Code
├─ init.py
├─ fit_export.py # FIT → CSV/JSON Export
└─ ... weitere Module



---

## ⚙️ Einrichtung auf einem neuen Rechner

### 1. Repository klonen
```bash
git clone git@github.com:<dein-user>/TrainMind.git
cd TrainMind

2. Virtuelle Umgebung erstellen

python -m venv .venv


3. Virtuelle Umgebung aktivieren

Windows (PowerShell):
.\.venv\Scripts\activate

4. Abhängigkeiten installieren

pip install -r requirements.txt


▶️ Nutzung

Lege deine FIT-Dateien in den Ordner data/.
Beispiel: data/rouvy_test.fit

Starte den Export:

python -m src.trainmind.fit_export

Ergebnisse:

data/exports/<name>_records.csv

data/exports/<name>_laps.csv

data/exports/<name>.json


