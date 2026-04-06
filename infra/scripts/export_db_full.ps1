param(
    [string]$OutputPath = "",
    [string]$ComposeFile = "infra/docker/docker-compose.yml",
    [string]$ContainerName = "trainmind-postgres",
    [string]$DbUser = "trainmind",
    [string]$DbName = "trainmind"
)

$ErrorActionPreference = "Stop"

if (-not $OutputPath) {
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $OutputPath = "data/backups/trainmind_full_$timestamp.dump"
}

$outputDir = Split-Path -Parent $OutputPath
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$resolvedOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    [System.IO.Path]::GetFullPath($OutputPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
}

$tempDumpPath = "/tmp/trainmind_full.dump"

docker compose -f $ComposeFile up -d postgres | Out-Null
docker compose -f $ComposeFile exec -T postgres rm -f $tempDumpPath | Out-Null
docker compose -f $ComposeFile exec -T postgres pg_dump `
    -U $DbUser `
    -d $DbName `
    -Fc `
    --no-owner `
    --no-privileges `
    -f $tempDumpPath

docker cp "${ContainerName}:${tempDumpPath}" $resolvedOutputPath
docker compose -f $ComposeFile exec -T postgres rm -f $tempDumpPath | Out-Null

Write-Host "Full database dump written to: $resolvedOutputPath"
