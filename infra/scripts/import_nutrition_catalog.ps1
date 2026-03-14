param(
    [string]$InputPath = "infra/seed/nutrition_catalog.sql",
    [string]$ComposeFile = "infra/docker/docker-compose.yml",
    [string]$DbUser = "trainmind",
    [string]$DbName = "trainmind",
    [switch]$ResetCatalog = $true
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputPath)) {
    throw "Input file not found: $InputPath"
}

if ($ResetCatalog) {
    docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName -c "TRUNCATE TABLE nutrition.food_item_sources, nutrition.food_items RESTART IDENTITY CASCADE;"
}

Get-Content $InputPath -Raw | docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName

Write-Host "Nutrition catalog import finished from: $InputPath"
