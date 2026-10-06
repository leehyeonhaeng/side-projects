#!/usr/bin/env bash
# 빌드 결과(dist)를 S3에 올리고 CloudFront를 무효화한다. CI(portal-deploy.yml)와 로컬 배포가 같이 쓴다.
# 사용: scripts/upload-web.sh <web_bucket> <distribution_id>   (frontend 폴더에서, AWS 자격 증명이 잡힌 상태)
set -euo pipefail

BUCKET="$1"
DIST_ID="$2"
cd "$(dirname "$0")/.."

# 해시가 붙은 정적 파일(assets/, workbox-*.js)은 오래 캐시.
# index.html·서비스워커·manifest·아이콘은 매번 확인 — sw.js가 캐시되면 새 버전을 못 찾는다 (DESIGN.md 9.2)
NO_CACHE=(index.html sw.js manifest.webmanifest theme-init.js favicon.ico)
for f in dist/*.png; do NO_CACHE+=("$(basename "$f")"); done

EXCLUDES=()
for f in "${NO_CACHE[@]}"; do EXCLUDES+=(--exclude "$f"); done

aws s3 sync dist "s3://$BUCKET" --delete "${EXCLUDES[@]}" --cache-control "public,max-age=31536000,immutable" --only-show-errors
for f in "${NO_CACHE[@]}"; do
  [ -f "dist/$f" ] && aws s3 cp "dist/$f" "s3://$BUCKET/$f" --cache-control "no-cache" --only-show-errors
done

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --query Invalidation.Id --output text
