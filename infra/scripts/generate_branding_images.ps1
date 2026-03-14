param(
  [string]$ApiKey = $env:OPENAI_API_KEY,
  [ValidateSet("icons", "all")]
  [string]$Preset = "icons",
  [string]$ImageModel = "gpt-image-1",
  [string]$SvgModel = "gpt-4.1-mini",
  [switch]$GenerateSvg
)

$ErrorActionPreference = "Stop"

if (-not $ApiKey) {
  throw "OPENAI_API_KEY missing. Set env var or pass -ApiKey."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$brandingRoot = Join-Path $repoRoot "assets\branding"

$targets = @()

function Add-Target {
  param(
    [string]$Path,
    [string]$Prompt,
    [string]$Size = "1024x1024"
  )
  $script:targets += [pscustomobject]@{
    Path = $Path
    Prompt = $Prompt
    Size = $Size
  }
}

Add-Target `
  -Path "icon\app-icon-1024.png" `
  -Size "1024x1024" `
  -Prompt @"
Create a 1024x1024 app icon for "TrainMind".
Style: flat, modern, high contrast, no text.
Motif: stylized T fused with route/graph signal.
Palette: #1F8B6F base, #173F37 dark accent.
Background: solid.
Keep edges crisp and shape simple for small-size readability.
"@

Add-Target `
  -Path "icon\app-icon-1024-transparent.png" `
  -Size "1024x1024" `
  -Prompt @"
Create the same TrainMind app icon design as the reference variant.
Output size: 1024x1024.
Background: fully transparent.
No text, no tiny details.
"@

Add-Target `
  -Path "icon\app-icon-mono-dark-1024.png" `
  -Size "1024x1024" `
  -Prompt @"
Create a monochrome dark variant of the TrainMind app icon.
Output size: 1024x1024.
Single-color dark icon on transparent background.
No text.
"@

Add-Target `
  -Path "icon\app-icon-mono-light-1024.png" `
  -Size "1024x1024" `
  -Prompt @"
Create a monochrome light variant of the TrainMind app icon.
Output size: 1024x1024.
Single-color light icon on transparent background.
No text.
"@

if ($Preset -eq "all") {
  Add-Target `
    -Path "logo\logo-trainmind-full.png" `
    -Size "1024x1024" `
    -Prompt @"
Create a clean vector-style logo for "TrainMind".
Style: modern, minimal, data-driven, athletic but calm.
Include one icon mark and readable wordmark "TrainMind".
Icon idea: abstract fusion of route line, pulse/metrics, and simple brain node pattern.
Avoid clutter, mascots, heavy gradients, and 3D.
Colors: #1F8B6F, #173F37, #EEF6F2.
White background.
"@

  Add-Target `
    -Path "logo\logo-trainmind-icon.png" `
    -Size "1024x1024" `
    -Prompt @"
Create an icon-only logo mark for "TrainMind".
Style: minimal and geometric.
Motif: route line + pulse + brain node abstraction.
No text.
Colors: #1F8B6F and #173F37.
Transparent background.
"@

  Add-Target `
    -Path "social\hub-hero-1920x1080.png" `
    -Size "1536x1024" `
    -Prompt @"
Create a wide hero illustration for TrainMind.
Scene: abstract dashboard energy, cycling/running data lines, subtle nutrition symbols.
Look: clean, soft gradients, premium SaaS style.
No faces, no third-party logos.
Color system based on #EEF6F2, #1F8B6F, #173F37.
"@

  Add-Target `
    -Path "social\og-trainmind-1200x630.png" `
    -Size "1536x1024" `
    -Prompt @"
Create an Open Graph style cover image for "TrainMind".
Compose logo left and tagline right:
"Dein Hub fuer Training, Ernaehrung und Fortschritt."
Style: minimal, modern, trustworthy.
Palette: #173F37 background, #EEF6F2 text, #6FC7AE accents.
"@

  Add-Target `
    -Path "splash\splash-trainmind-portrait.png" `
    -Size "1024x1536" `
    -Prompt @"
Create a clean mobile splash screen for TrainMind.
Centered icon mark only.
Background: #EEF6F2.
Icon color: #1F8B6F and #173F37.
Large safe margins and minimal composition.
"@
}

function Invoke-OpenAIImage {
  param(
    [string]$Prompt,
    [string]$Size,
    [string]$OutFile
  )

  $body = @{
    model = $ImageModel
    prompt = $Prompt
    size = $Size
  } | ConvertTo-Json -Depth 8

  $headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type" = "application/json"
  }

  $response = Invoke-RestMethod `
    -Uri "https://api.openai.com/v1/images/generations" `
    -Method Post `
    -Headers $headers `
    -Body $body

  if (-not $response.data -or -not $response.data[0].b64_json) {
    throw "No b64_json image data returned for $OutFile"
  }

  $bytes = [Convert]::FromBase64String($response.data[0].b64_json)
  [IO.File]::WriteAllBytes($OutFile, $bytes)
}

function Invoke-OpenAISvg {
  param(
    [string]$OutFile
  )

  $svgPrompt = @"
Create a production-ready SVG icon for "TrainMind".
Style: flat, geometric, minimal.
Motif: stylized T fused with route/graph signal.
No text, no gradients, no shadows, no filters.
Use solid fills only with colors #1F8B6F and #173F37.
Canvas size: 1024 by 1024.
Return only raw SVG markup.
"@

  $body = @{
    model = $SvgModel
    messages = @(
      @{ role = "system"; content = "You output only valid SVG markup, no markdown fences." },
      @{ role = "user"; content = $svgPrompt }
    )
    temperature = 0.2
  } | ConvertTo-Json -Depth 8

  $headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type" = "application/json"
  }

  $response = Invoke-RestMethod `
    -Uri "https://api.openai.com/v1/chat/completions" `
    -Method Post `
    -Headers $headers `
    -Body $body

  $content = $response.choices[0].message.content
  if (-not $content) {
    throw "No SVG text returned."
  }

  $clean = $content.Trim()
  $clean = $clean -replace "^```svg\s*", ""
  $clean = $clean -replace "^```\s*", ""
  $clean = $clean -replace "\s*```$", ""

  Set-Content -Path $OutFile -Value $clean -Encoding UTF8
}

Write-Host "Generating branding assets using preset '$Preset'..."

foreach ($target in $targets) {
  $outFile = Join-Path $brandingRoot $target.Path
  $outDir = Split-Path $outFile -Parent
  if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  Write-Host " -> $($target.Path)"
  Invoke-OpenAIImage -Prompt $target.Prompt -Size $target.Size -OutFile $outFile
}

if ($GenerateSvg) {
  $svgOut = Join-Path $brandingRoot "icon\app-icon-source.svg"
  Write-Host " -> icon\app-icon-source.svg"
  Invoke-OpenAISvg -OutFile $svgOut
}

Write-Host "Done."
