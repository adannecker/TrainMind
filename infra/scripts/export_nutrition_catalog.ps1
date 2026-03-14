param(
    [string]$OutputPath = "infra/seed/nutrition_catalog.sql",
    [string]$ComposeFile = "infra/docker/docker-compose.yml",
    [string]$DbUser = "trainmind",
    [string]$DbName = "trainmind"
)

$ErrorActionPreference = "Stop"

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

docker compose -f $ComposeFile exec -T postgres pg_dump `
    -U $DbUser `
    -d $DbName `
    --data-only `
    --inserts `
    --column-inserts `
    --no-owner `
    --no-privileges `
    --table=nutrition.food_items `
    --table=nutrition.food_item_sources `
    | Set-Content -Encoding utf8 $OutputPath

Write-Host "Nutrition catalog dump written to: $OutputPath"
