"""موقعیت تقریبی از روی IP — کاملاً اختیاری و بی‌خطر.

اگر پایگاه دادهٔ MaxMind (GeoLite2-City.mmdb) روی سرور تنظیم شده باشد (متغیر
`GEOIP_PATH`)، شهر/کشور استخراج می‌شود؛ وگرنه رشتهٔ خالی برمی‌گردد و چیزی خراب
نمی‌شود. هیچ درخواست بیرونی‌ای زده نمی‌شود.
"""

from functools import lru_cache

from django.conf import settings


@lru_cache(maxsize=1)
def _reader():
    path = getattr(settings, "GEOIP_PATH", "") or ""
    if not path:
        return None
    try:
        import geoip2.database  # type: ignore

        return geoip2.database.Reader(path)
    except Exception:
        return None


def lookup(ip: str):
    """(city, country) تقریبی برای یک IP؛ در صورت نبود داده ('', '')."""
    if not ip:
        return "", ""
    reader = _reader()
    if reader is None:
        return "", ""
    try:
        r = reader.city(ip)
        city = (r.city.names.get("fa") or r.city.name or "") if r.city else ""
        country = (r.country.names.get("fa") or r.country.name or "") if r.country else ""
        return city, country
    except Exception:
        return "", ""
