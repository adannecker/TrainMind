param(
  [string]$InputDir = ".\assets\branding\inbox",
  [switch]$CleanWebPublic
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$inputPath = Resolve-Path $InputDir -ErrorAction SilentlyContinue
if (-not $inputPath) {
  throw "Input folder not found: $InputDir"
}
$inputPath = $inputPath.Path

$brandingRoot = Join-Path $repoRoot "assets\branding"
$webPublic = Join-Path $repoRoot "apps\web\public"
New-Item -ItemType Directory -Force -Path $webPublic | Out-Null

if ($CleanWebPublic) {
  Get-ChildItem $webPublic -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".png", ".ico", ".svg", ".webmanifest", ".jpg", ".jpeg", ".webp" } |
    Remove-Item -Force
}

function Copy-IfPresent {
  param(
    [string]$SourceName,
    [string]$TargetRelPath
  )

  $source = Join-Path $inputPath $SourceName
  if (-not (Test-Path $source)) {
    Write-Host "Skip (missing): $SourceName"
    return $false
  }
  $target = Join-Path $repoRoot $TargetRelPath
  $targetDir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item $source $target -Force
  Write-Host "Copied: $SourceName -> $TargetRelPath"
  return $true
}

Add-Type -AssemblyName System.Drawing
function Resize-Png {
  param(
    [string]$SourcePath,
    [string]$TargetPath,
    [int]$Width,
    [int]$Height
  )
  $img = [System.Drawing.Image]::FromFile($SourcePath)
  try {
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($img, 0, 0, $Width, $Height)
        $bmp.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
      }
      finally { $g.Dispose() }
    }
    finally { $bmp.Dispose() }
  }
  finally { $img.Dispose() }
}

# 1) Copy masters into branding folders (if present in inbox)
Copy-IfPresent "app-icon-1024.png" "assets/branding/icon/app-icon-1024.png" | Out-Null
Copy-IfPresent "app-icon-1024-transparent.png" "assets/branding/icon/app-icon-1024-transparent.png" | Out-Null
Copy-IfPresent "app-icon-mono-dark-1024.png" "assets/branding/icon/app-icon-mono-dark-1024.png" | Out-Null
Copy-IfPresent "app-icon-mono-light-1024.png" "assets/branding/icon/app-icon-mono-light-1024.png" | Out-Null
Copy-IfPresent "app-icon-source.svg" "assets/branding/icon/app-icon-source.svg" | Out-Null
Copy-IfPresent "favicon-source-1024.png" "assets/branding/icon/favicon-source-1024.png" | Out-Null
Copy-IfPresent "apple-touch-icon-source-1024.png" "assets/branding/icon/apple-touch-icon-source-1024.png" | Out-Null
Copy-IfPresent "og-trainmind-1200x630.png" "assets/branding/social/og-trainmind-1200x630.png" | Out-Null
Copy-IfPresent "hub-hero-1920x1080.png" "assets/branding/social/hub-hero-1920x1080.png" | Out-Null
Copy-IfPresent "hub-hero-1600x900.png" "assets/branding/social/hub-hero-1600x900.png" | Out-Null
Copy-IfPresent "logo-trainmind-full.svg" "assets/branding/logo/logo-trainmind-full.svg" | Out-Null
Copy-IfPresent "logo-trainmind-icon.svg" "assets/branding/logo/logo-trainmind-icon.svg" | Out-Null
Copy-IfPresent "logo-trainmind-mono-dark.svg" "assets/branding/logo/logo-trainmind-mono-dark.svg" | Out-Null
Copy-IfPresent "logo-trainmind-mono-light.svg" "assets/branding/logo/logo-trainmind-mono-light.svg" | Out-Null
Copy-IfPresent "splash-trainmind-portrait.png" "assets/branding/splash/splash-trainmind-portrait.png" | Out-Null
Copy-IfPresent "splash-trainmind-landscape.png" "assets/branding/splash/splash-trainmind-landscape.png" | Out-Null

# 2) Build web public derivatives from source masters
$favMaster = Join-Path $brandingRoot "icon\favicon-source-1024.png"
$appleMaster = Join-Path $brandingRoot "icon\apple-touch-icon-source-1024.png"
$ogMaster = Join-Path $brandingRoot "social\og-trainmind-1200x630.png"

if (Test-Path $favMaster) {
  Resize-Png -SourcePath $favMaster -TargetPath (Join-Path $webPublic "favicon-16x16.png") -Width 16 -Height 16
  Resize-Png -SourcePath $favMaster -TargetPath (Join-Path $webPublic "favicon-32x32.png") -Width 32 -Height 32
  Copy-Item (Join-Path $webPublic "favicon-32x32.png") (Join-Path $webPublic "favicon.ico") -Force
  Write-Host "Created web favicons"
} else {
  Write-Host "Skip web favicons (missing master): assets/branding/icon/favicon-source-1024.png"
}

if (Test-Path $appleMaster) {
  Resize-Png -SourcePath $appleMaster -TargetPath (Join-Path $webPublic "apple-touch-icon.png") -Width 180 -Height 180
  Resize-Png -SourcePath $appleMaster -TargetPath (Join-Path $webPublic "android-chrome-192x192.png") -Width 192 -Height 192
  Resize-Png -SourcePath $appleMaster -TargetPath (Join-Path $webPublic "android-chrome-512x512.png") -Width 512 -Height 512
  Write-Host "Created apple/android web icons"
} else {
  Write-Host "Skip apple/android icons (missing master): assets/branding/icon/apple-touch-icon-source-1024.png"
}

if (Test-Path $ogMaster) {
  Copy-Item $ogMaster (Join-Path $webPublic "og-trainmind-1200x630.png") -Force
  Write-Host "Copied web OG image"
} else {
  Write-Host "Skip OG image (missing): assets/branding/social/og-trainmind-1200x630.png"
}

$manifest = @{
  name = "TrainMind"
  short_name = "TrainMind"
  icons = @(
    @{ src = "/android-chrome-192x192.png"; sizes = "192x192"; type = "image/png" },
    @{ src = "/android-chrome-512x512.png"; sizes = "512x512"; type = "image/png" }
  )
  theme_color = "#173F37"
  background_color = "#EEF6F2"
  display = "standalone"
} | ConvertTo-Json -Depth 5 -Compress
Set-Content -Path (Join-Path $webPublic "site.webmanifest") -Value $manifest -Encoding UTF8
Write-Host "Wrote web manifest"

Write-Host "Done."
