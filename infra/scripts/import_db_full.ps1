param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [string]$ComposeFile = "infra/docker/docker-compose.yml",
    [string]$ContainerName = "trainmind-postgres",
    [string]$DbUser = "trainmind",
    [string]$DbName = "trainmind"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputPath)) {
    throw "Input file not found: $InputPath"
}

$resolvedInputPath = (Resolve-Path $InputPath).Path
$tempImportPath = "/tmp/trainmind_full.dump"

docker compose -f $ComposeFile up -d postgres | Out-Null
docker compose -f $ComposeFile exec -T postgres rm -f $tempImportPath | Out-Null
docker cp $resolvedInputPath "${ContainerName}:${tempImportPath}"
docker compose -f $ComposeFile exec -T postgres pg_restore `
    -U $DbUser `
    -d $DbName `
    --clean `
    --if-exists `
    --no-owner `
    --no-privileges `
    $tempImportPath
docker compose -f $ComposeFile exec -T postgres rm -f $tempImportPath | Out-Null

Write-Host "Full database import finished from: $resolvedInputPath"
Write-Host "Start or restart the application stack afterwards so the services pick up the imported data."
