"""Rate-limit helpers.

DRF's own `get_ident` believes the whole `X-Forwarded-For` header, and a client can put anything in it,
so a different value per attempt made every attempt a "new" visitor (the login limit never fired).
nginx sets `X-Real-IP` itself from the address it resolved (after the CDN, see nginx/cdn-ips.conf), and
nobody else can reach Django, so that header is the one to trust.
"""

import hashlib

from django.core.cache import cache
from rest_framework.throttling import ScopedRateThrottle


def request_ip(request) -> str:
    meta = request.META
    return (meta.get("HTTP_X_REAL_IP") or meta.get("REMOTE_ADDR") or "").strip()[:64]


def within_limit(prefix: str, request, limit: int, seconds: int) -> bool:
    """Count one event for this address; False once more than `limit` happened in `seconds`.

    The address is stored hashed and only in the cache (it expires), never in the database. The counter
    lives in each web worker's own memory, so the effective limit is about `limit` times the worker count.
    """
    ip = request_ip(request)
    if limit <= 0 or not ip:
        return True
    key = f"{prefix}:{hashlib.sha256(ip.encode()).hexdigest()[:20]}"
    cache.add(key, 0, seconds)
    try:
        count = cache.incr(key)
    except ValueError:  # the key expired between add and incr
        cache.set(key, 1, seconds)
        count = 1
    return count <= limit


class RealIPScopedRateThrottle(ScopedRateThrottle):
    def get_ident(self, request):
        return request_ip(request)
