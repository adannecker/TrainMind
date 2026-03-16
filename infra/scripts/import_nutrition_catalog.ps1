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

$resolvedInputPath = (Resolve-Path $InputPath).Path
$tempImportPath = "/tmp/trainmind_nutrition_catalog.sql"

docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName -c @"
ALTER TABLE nutrition.food_items
    ALTER COLUMN usda_status SET DEFAULT 'unknown',
    ALTER COLUMN health_indicator SET DEFAULT 'neutral';
"@

if ($ResetCatalog) {
    docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName -c "TRUNCATE TABLE nutrition.food_item_sources, nutrition.food_items RESTART IDENTITY CASCADE;"
}

docker cp $resolvedInputPath trainmind-postgres:$tempImportPath
docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName -f $tempImportPath
docker compose -f $ComposeFile exec -T postgres rm -f $tempImportPath

docker compose -f $ComposeFile exec -T postgres psql -U $DbUser -d $DbName -c @"
UPDATE nutrition.food_items
SET usda_status = 'valid'
WHERE lower(coalesce(source_label, '')) = 'usda fooddata central'
  AND lower(coalesce(trust_level, '')) = 'high'
  AND lower(coalesce(verification_status, '')) IN ('source_linked', 'verified');

ALTER TABLE nutrition.food_items
    ALTER COLUMN usda_status DROP DEFAULT,
    ALTER COLUMN health_indicator DROP DEFAULT;
"@

Write-Host "Nutrition catalog import finished from: $InputPath"
