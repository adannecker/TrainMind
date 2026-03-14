param(
  [string]$JobsFile = ".\infra\scripts\browser_image_automation\branding-jobs.example.json",
  [string]$Url = "https://chatgpt.com/",
  [int]$TimeoutSec = 300,
  [switch]$KeepOpen
)

$ErrorActionPreference = "Stop"

$jobsPath = (Resolve-Path $JobsFile).Path
$toolDir = Resolve-Path ".\infra\scripts\browser_image_automation"
Push-Location $toolDir
try {
  if (-not (Test-Path ".\node_modules\playwright")) {
    Write-Host "Installing Playwright dependencies..."
    npm install
  }

  $cmd = @(
    ".\generate_images_via_browser.js",
    "--jobs", $jobsPath,
    "--url", $Url,
    "--timeoutSec", "$TimeoutSec"
  )

  if ($KeepOpen) {
    $cmd += "--keepOpen"
  }

  Write-Host "Starting browser image automation..."
  & node @cmd
}
finally {
  Pop-Location
}
