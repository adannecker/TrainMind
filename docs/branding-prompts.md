# Branding, Logo und Image Prompts

## Zweck

Diese Datei sammelt Vorlagen fuer:

- Logo-Generierung
- App-Icon-Generierung
- Hero-/Header-Bilder
- Social-Preview-Bilder

## Automatische Generierung (OpenAI API)

Script:

- `infra/scripts/generate_branding_images.ps1`

Voraussetzung:

- Environment Variable `OPENAI_API_KEY` gesetzt

Nur Icon-Set erzeugen:

```powershell
.\infra\scripts\generate_branding_images.ps1
```

Icon-Set plus SVG-Source:

```powershell
.\infra\scripts\generate_branding_images.ps1 -GenerateSvg
```

Alle Branding-Bilder erzeugen:

```powershell
.\infra\scripts\generate_branding_images.ps1 -Preset all -GenerateSvg
```

## Browser-Automation (ohne API-Key im Script)

Wenn du lieber im bereits eingeloggten Browser arbeitest, nutze:

- `infra/scripts/generate_branding_images_browser.ps1`

Was es macht:

- oeffnet `chatgpt.com` in einem automatisierten Browser
- du kannst dich bei Bedarf manuell einloggen
- das Script sendet Jobs/Prompts und speichert erkannte Bilder lokal

Start (Beispiel):

```powershell
.\infra\scripts\generate_branding_images_browser.ps1
```

Mit eigener Job-Datei:

```powershell
.\infra\scripts\generate_branding_images_browser.ps1 -JobsFile .\infra\scripts\browser_image_automation\branding-jobs.example.json
```

Job-Datei-Vorlage:

- `infra/scripts/browser_image_automation/branding-jobs.example.json`

## Manueller Download + Auto-Import (empfohlen)

Wenn du Bilder manuell im Browser erzeugst und herunterlaedst, kannst du sie automatisch korrekt verteilen:

1. Lege die Dateien mit den erwarteten Namen in:
   - `assets/branding/inbox`
2. Fuehre aus:

```powershell
.\infra\scripts\import_branding_assets.ps1
```

Optional mit Web-Ordner-Cleanup vorher:

```powershell
.\infra\scripts\import_branding_assets.ps1 -CleanWebPublic
```

Das Script:

- kopiert Master-Dateien von `assets/branding/inbox` nach `assets/branding/...`
- erzeugt Web-Zielformate in `apps/web/public`
- schreibt `apps/web/public/site.webmanifest`

## Brand-Richtung (TrainMind)

- Kernidee: Training + Daten + Klarheit
- Mood: ruhig, praezise, modern, vertrauenswuerdig
- Stil: clean, geometrisch, leicht technisch
- Farben (Startpunkt):
  - Primar: `#1F8B6F`
  - Dunkel: `#173F37`
  - Hell: `#EEF6F2`
  - Akzent: `#6FC7AE`
- Wichtige Klarstellung:
  - "Train" bedeutet "trainieren" (Fitness, Ausdauer, Leistung)
  - Nicht gemeint: Zug, Eisenbahn, Schienen, Lokomotive
- Wichtige Ausgabe-Regel:
  - Immer nur **ein Asset pro Generierung**
  - Kein Grid, kein Kontaktbogen, kein Multi-Preview
  - Kein Device-Mockup, kein Poster-Layout, keine Collage

## Prompt 1: Logo (Wordmark + Symbol)

Status: `Pflicht`

Dateiname/Pfad:

- `assets/branding/logo/logo-trainmind-full.svg`
- `assets/branding/logo/logo-trainmind-icon.svg`
- `assets/branding/logo/logo-trainmind-mono-dark.svg`
- `assets/branding/logo/logo-trainmind-mono-light.svg`

OpenAI Image Prompts (ein Prompt pro Datei):

`assets/branding/logo/logo-trainmind-full.svg` (oder zuerst PNG, danach SVG nachzeichnen)

```text
Create a clean full logo for "TrainMind" with icon mark + wordmark.
Meaning note: "Train" means fitness training, not railway train.
Style: modern, minimal, data-driven, athletic but calm.
Icon idea: abstract fusion of route line, pulse/metrics, and a simple brain node pattern.
Avoid clutter, mascots, heavy gradients and 3D.
Never include railway visuals (tracks, locomotive, wagons, stations).
Colors: #1F8B6F, #173F37, #EEF6F2.
Return exactly one isolated logo on a transparent background.
No collage, no comparison grid, no mockup.
```

`assets/branding/logo/logo-trainmind-icon.svg` (oder zuerst PNG, danach SVG nachzeichnen)

```text
Create an icon-only logo mark for "TrainMind".
Meaning note: fitness training brand, not railway.
Style: geometric, minimal, modern.
Motif: route line + metric pulse + abstract brain node pattern.
No text.
Colors: #1F8B6F and #173F37.
Return exactly one isolated icon on transparent background.
No collage, no comparison grid, no mockup.
```

`assets/branding/logo/logo-trainmind-mono-dark.svg` (oder zuerst PNG, danach SVG nachzeichnen)

```text
Create a monochrome dark version of the TrainMind full logo.
Keep the same composition as the primary full logo (icon + wordmark).
Single dark color only.
Transparent background.
Return exactly one isolated logo.
No collage, no comparison grid, no mockup, no railway visuals.
```

`assets/branding/logo/logo-trainmind-mono-light.svg` (oder zuerst PNG, danach SVG nachzeichnen)

```text
Create a monochrome light version of the TrainMind full logo.
Keep the same composition as the primary full logo (icon + wordmark).
Single light color only.
Transparent background.
Return exactly one isolated logo.
No collage, no comparison grid, no mockup, no railway visuals.
```

Ablageregel:

- Diese 4 Dateinamen sind unterschiedliche Varianten und sollten als eigene Dateien erzeugt werden.
- Nicht einfach eine Datei 4x unter anderem Namen speichern.

## Prompt 2: App Icon

Status: `Pflicht`

Dateiname/Pfad:

- `assets/branding/icon/app-icon-1024.png`
- `assets/branding/icon/app-icon-1024-transparent.png`
- `assets/branding/icon/app-icon-mono-dark-1024.png`
- `assets/branding/icon/app-icon-mono-light-1024.png`
- `assets/branding/icon/app-icon-source.svg`

```text
Design a mobile app icon for "TrainMind".
Meaning note: "Train" means training/workout, not railway train.
Square format, high contrast, simple shape.
Motif: stylized "T" combined with route/graph signal.
Flat design, no text, no tiny details.
Palette: #1F8B6F base with dark accent #173F37.
Do not use train or rail symbols.
Provide 1024x1024 master PNG and vector source style.
```

OpenAI Image Prompts (ein Prompt pro Datei):

`assets/branding/icon/app-icon-1024.png`

```text
Create a 1024x1024 app icon for "TrainMind".
Meaning note: "Train" means fitness training, not railway train.
Style: flat, modern, high contrast, no text.
Motif: stylized "T" fused with route/graph signal.
Palette: #1F8B6F base, #173F37 dark accent.
Background: solid.
Keep edges crisp and shape simple for small-size readability.
No railway imagery.
Return exactly one icon on one canvas.
No collage, no comparison grid, no mockup frame.
```

`assets/branding/icon/app-icon-1024-transparent.png`

```text
Create the same TrainMind app icon design as the reference variant.
Output size: 1024x1024.
Background: fully transparent.
No text, no tiny details.
No railway imagery.
Return exactly one icon on one canvas.
No collage, no comparison grid, no mockup frame.
```

`assets/branding/icon/app-icon-mono-dark-1024.png`

```text
Create a monochrome dark variant of the TrainMind app icon.
Output size: 1024x1024.
Single-color dark icon on transparent background.
No text.
No railway imagery.
Return exactly one icon on one canvas.
No collage, no comparison grid, no mockup frame.
```

`assets/branding/icon/app-icon-mono-light-1024.png`

```text
Create a monochrome light variant of the TrainMind app icon.
Output size: 1024x1024.
Single-color light icon on transparent background.
No text.
No railway imagery.
Return exactly one icon on one canvas.
No collage, no comparison grid, no mockup frame.
```

`assets/branding/icon/app-icon-source.svg`

```text
Recreate the final TrainMind app icon as a clean production SVG.
Style: flat, geometric, minimal, no text.
Use solid fills only with #1F8B6F and #173F37.
No gradients, no shadows, no effects.
Return valid raw SVG markup.
```

Ablageregel:

- Jede oben genannte Datei ist ein eigener Output.
- Keine Datei nur umbenennen, wenn die Variante visuell anders sein soll.

## Prompt 3: Hub Hero Image

Status: `Optional`

Dateiname/Pfad:

- `assets/branding/social/hub-hero-1920x1080.png`
- `assets/branding/social/hub-hero-1600x900.png`

```text
Create a wide hero illustration for a training analytics platform called TrainMind.
Meaning note: "TrainMind" refers to sports training, not railway.
Scene: abstract dashboard energy, cycling/running data lines, subtle nutrition symbols.
Look: clean, soft gradients, premium SaaS style.
No people faces, no brand logos from third parties.
No railway visuals.
Color system based on #EEF6F2, #1F8B6F, #173F37.
Output: 1920x1080 and 1600x900.
```

Ablageregel:

- Entweder zwei getrennte Generierungen machen, oder ein Master-Bild erzeugen und sauber auf beide Zielgroessen exportieren.

## Prompt 4: Social Preview (Open Graph)

Status: `Pflicht`

Dateiname/Pfad:

- `assets/branding/social/og-trainmind-1200x630.png`

```text
Create an Open Graph cover image for "TrainMind".
Meaning note: sports training platform, not railway domain.
Size: 1200x630.
Content: TrainMind logo left, short tagline right:
"Dein Hub fuer Training, Ernaehrung und Fortschritt."
Style: minimal, modern, trustworthy.
Color palette: #173F37 background, #EEF6F2 text, #6FC7AE accents.
No railway visuals.
```

## Prompt 5: Splash Screen (Mobile)

Status: `Optional`

Dateiname/Pfad:

- `assets/branding/splash/splash-trainmind-portrait.png`
- `assets/branding/splash/splash-trainmind-landscape.png`

```text
Create a clean mobile splash screen for TrainMind.
Meaning note: training app branding, not railway.
Centered icon mark only, no long text.
Background: very light tone #EEF6F2.
Icon color: #1F8B6F and #173F37.
Keep composition simple with large safe margins.
No railway visuals.
```

Ablageregel:

- Portrait und Landscape sind zwei eigene Zieldateien.
- Falls du nur ein Master hast, jeweils passend zuschneiden/exportieren.

## Prompt 6: Webservice Icons und Browser Assets

Status: `Pflicht`

Dateiname/Pfad (Branding-Quelle):

- `assets/branding/icon/favicon-source-1024.png`
- `assets/branding/icon/apple-touch-icon-source-1024.png`
- `assets/branding/social/og-trainmind-1200x630.png`

Zielpfad im Webservice (`apps/web/public`):

- `apps/web/public/favicon.ico`
- `apps/web/public/favicon-16x16.png`
- `apps/web/public/favicon-32x32.png`
- `apps/web/public/apple-touch-icon.png`
- `apps/web/public/og-trainmind-1200x630.png`
- `apps/web/public/android-chrome-192x192.png`
- `apps/web/public/android-chrome-512x512.png`

OpenAI Image Prompts (ein Prompt pro Datei):

`assets/branding/icon/favicon-source-1024.png`

```text
Create a 1024x1024 source icon for TrainMind favicon generation.
Meaning note: "Train" means workout training, not train transport.
Style: flat, minimal, high contrast, no text.
Motif: stylized T fused with route/graph signal.
Palette: #1F8B6F and #173F37.
Solid background.
Optimized for downscaling to 32x32 and 16x16.
No railway visuals.
```

`assets/branding/icon/apple-touch-icon-source-1024.png`

```text
Create a 1024x1024 source icon for Apple touch icon.
Meaning note: fitness training brand, not railway.
Style: clean, modern, flat.
No text.
Motif consistent with TrainMind app icon.
Use subtle rounded-corner-friendly composition with generous padding.
Palette: #1F8B6F, #173F37, #EEF6F2.
No railway visuals.
```

`assets/branding/social/og-trainmind-1200x630.png`

```text
Create a social preview image for TrainMind in 1200x630.
Meaning note: sports training platform, not railway.
Layout: logo/icon on left, title and short tagline on right.
Tagline: "Dein Hub fuer Training, Ernaehrung und Fortschritt."
Style: minimal SaaS, trustworthy, clean.
Palette: #173F37 background, #EEF6F2 text, #6FC7AE accents.
No railway visuals.
```

Nachbearbeitung (Resize/Export):

- `favicon-source-1024.png` -> `favicon-32x32.png` und `favicon-16x16.png`
- `apple-touch-icon-source-1024.png` -> `apple-touch-icon.png` (180x180)
- `apple-touch-icon-source-1024.png` -> `android-chrome-192x192.png`
- `apple-touch-icon-source-1024.png` -> `android-chrome-512x512.png`
- optional aus `favicon-32x32.png` + `favicon-16x16.png` eine `favicon.ico` erstellen

Ablageregel:

- Die Dateien in `assets/branding/...` sind Master/Quellen.
- Die Dateien in `apps/web/public/...` sind Deploy-Ziele und sollen aus den Master-Dateien erzeugt werden (Resize/Export/Kopie, je nach Format).

## Prompt- und Datei-Matrix (1-6)

1. Prompt 1 (Logo):
   - benoetigt: ja
   - alle Dateinamen haben Promptabdeckung: ja
   - Mehrfachspeichern gleicher Datei: nein (eigene Varianten)
2. Prompt 2 (App Icon):
   - benoetigt: ja
   - alle Dateinamen haben Promptabdeckung: ja
   - Mehrfachspeichern gleicher Datei: nein (eigene Varianten)
3. Prompt 3 (Hub Hero):
   - benoetigt: optional
   - alle Dateinamen haben Promptabdeckung: ja
   - Mehrfachspeichern gleicher Datei: ja, als Resize aus Master moeglich
4. Prompt 4 (OG):
   - benoetigt: ja
   - alle Dateinamen haben Promptabdeckung: ja
   - Mehrfachspeichern gleicher Datei: nein
5. Prompt 5 (Splash):
   - benoetigt: optional
   - alle Dateinamen haben Promptabdeckung: ja
   - Mehrfachspeichern gleicher Datei: ja, mit passendem Export je Orientierung
6. Prompt 6 (Webservice Icons):
   - benoetigt: ja
   - alle Dateinamen haben Promptabdeckung: ja (Master + Nachbearbeitung)
   - Mehrfachspeichern gleicher Datei: ja, fuer Web-Zielformate vorgesehen

## Negative Prompt (optional)

```text
Avoid photorealism, stock-photo look, random athletes, noisy textures, heavy shadows, glossy 3D, tiny unreadable details.
```

## Export-Checkliste

- Logo:
  - SVG (Master)
  - PNG transparent (2048px breit)
  - Monochrom Varianten
- App Icon:
  - PNG 1024x1024 (Master)
- OG Image:
  - PNG 1200x630
- Favicon:
  - PNG 32x32 und 16x16

## Dateikonvention (Vorschlag)

- `assets/branding/logo/logo-trainmind-full.svg`
- `assets/branding/logo/logo-trainmind-icon.svg`
- `assets/branding/logo/logo-trainmind-mono-dark.svg`
- `assets/branding/logo/logo-trainmind-mono-light.svg`
- `assets/branding/icon/app-icon-1024.png`
- `assets/branding/social/og-trainmind-1200x630.png`
