param(
  [switch]$Build
)

$composeFile = "infra/docker/docker-compose.yml"
if ($Build) {
  docker compose -f $composeFile up -d --build
} else {
  docker compose -f $composeFile up -d
}
