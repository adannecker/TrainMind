#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo ".env fehlt. Bitte zuerst .env anlegen."
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${PUBLIC_DOMAIN:-}" ]]; then
  echo "PUBLIC_DOMAIN ist in .env nicht gesetzt."
  exit 1
fi

if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
  echo "LETSENCRYPT_EMAIL ist in .env nicht gesetzt."
  exit 1
fi

HUB_WEB_WAS_RUNNING=0
NGINX_PROXY_WAS_RUNNING=0

if docker ps --format '{{.Names}}' | grep -qx trainmind-hub-web; then
  HUB_WEB_WAS_RUNNING=1
  docker stop trainmind-hub-web >/dev/null
fi

if docker ps --format '{{.Names}}' | grep -qx trainmind-nginx-proxy; then
  NGINX_PROXY_WAS_RUNNING=1
  docker stop trainmind-nginx-proxy >/dev/null
fi

restore_previous_services() {
  if [[ "$HUB_WEB_WAS_RUNNING" == "1" ]]; then
    docker start trainmind-hub-web >/dev/null || true
  fi
  if [[ "$NGINX_PROXY_WAS_RUNNING" == "1" ]]; then
    docker start trainmind-nginx-proxy >/dev/null || true
  fi
}

trap 'restore_previous_services' ERR

docker volume create trainmind_letsencrypt >/dev/null
docker volume create trainmind_certbot_www >/dev/null

docker run --rm \
  -p 80:80 \
  -v trainmind_letsencrypt:/etc/letsencrypt \
  -v trainmind_certbot_www:/var/www/certbot \
  certbot/certbot certonly \
  --standalone \
  --preferred-challenges http \
  --non-interactive \
  --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$PUBLIC_DOMAIN"

trap - ERR

docker compose -f infra/docker/docker-compose.prod.yml up -d --build --remove-orphans
