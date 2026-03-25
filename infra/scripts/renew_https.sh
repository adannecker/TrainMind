#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

docker run --rm \
  -v trainmind_letsencrypt:/etc/letsencrypt \
  -v trainmind_certbot_www:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot

docker exec trainmind-nginx-proxy nginx -s reload
