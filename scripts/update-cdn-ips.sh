#!/bin/sh
# Rewrites nginx/cdn-ips.conf from ArvanCloud's published list of edge networks.
#   sh scripts/update-cdn-ips.sh && docker compose up -d nginx
# Only the networks in that file are trusted when nginx reads the visitor's address from
# X-Forwarded-For; a request that reaches the server directly keeps its own address.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/nginx/cdn-ips.conf"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl -fsSL --retry 3 -m 30 https://www.arvancloud.ir/en/ips.txt | tr -d '\r' | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' > "$tmp"
if [ "$(wc -l < "$tmp")" -lt 5 ]; then
  echo "The list looks wrong (fewer than 5 networks); nothing was changed." >&2
  exit 1
fi
{
  echo "# شبکه‌های CDN (آروان‌کلود) که nginx به X-Forwarded-Forشان اعتماد می‌کند؛ فقط درخواستی که از این شبکه‌ها"
  echo "# برسد آدرس واقعی کاربر را از آن سرآیند می‌گیرد. درخواست مستقیم به سرور هر سرآیندی بفرستد آدرس خودش می‌ماند."
  echo "# منبع: https://www.arvancloud.ir/en/ips.txt ($(date +%F)). به‌روزرسانی: sh scripts/update-cdn-ips.sh و بعد"
  echo "# docker compose up -d nginx. اگر CDN دیگری دارید همین فایل را با شبکه‌های آن بنویسید؛ اگر CDN ندارید خالی بگذارید."
  sed 's/^/set_real_ip_from /; s/$/;/' "$tmp"
  echo "real_ip_header X-Forwarded-For;"
  echo "real_ip_recursive on;"
} > "$out"
echo "Wrote $out with $(wc -l < "$tmp") networks."
