# Mobile App

## Stand

Pfad: `apps/mobile`

Aktuell ist eine Expo/React-Native Prototype-App vorhanden mit:

- Login gegen `POST /api/auth/login`
- Nutrition-Eintraege laden/anlegen/loeschen
- API-Zugriff fuer Android Emulator via `10.0.2.2`

## Voraussetzungen

- Android Studio inkl. Emulator
- Android SDK + JDK (Android Studio JBR)
- laufender Backend-Stack (`hub-web` auf `:8000`)

## Start (Windows, PowerShell)

```powershell
cd apps/mobile
npm install

$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\<dein-user>\AppData\Local\Android\Sdk'
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

npm run android
```

## API-Konfiguration

In `apps/mobile/App.tsx` ist aktuell gesetzt:

- `API_BASE_URL = "http://10.0.2.2:8000/api"`

Hinweise:

- Android Emulator nutzt `10.0.2.2` fuer Host-Zugriff.
- iOS Simulator nutzt typischerweise `127.0.0.1`.

## Typische Probleme

### Langes Build beim ersten Start

Der erste `npm run android` kann mehrere Minuten dauern (Gradle Full Build, Native Libs, APK Install).

### Red Screen: `Cannot find native module 'ExpoAsset'`

Ursache: Native Expo-Module nicht korrekt im Build.

Abhilfe:

```powershell
cd apps/mobile
npx expo install expo-asset expo-constants expo-file-system expo-font expo-keep-awake
npx expo prebuild --clean
npm run android
```

### Bundling haengt bei 50%

Meist Metro/Port-Thema.

Abhilfe:

```powershell
cd apps/mobile
npx expo start --clear --port 8081
```

Danach App im Emulator neu laden.

## Geplanter naechster Ausbau

1. Token sicher lokal speichern (z. B. SecureStore).
2. Offline-faehige lokale Datenhaltung (SQLite) + Sync ueber `/nutrition/sync`.
3. Formulare fuer Food-Item-Wiederverwendung und Tagesuebersicht.
4. Einheitliche Fehler- und Ladezustaende.
