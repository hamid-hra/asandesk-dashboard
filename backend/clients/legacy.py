"""کلاینت‌های قدیمی: دستگاه‌هایی که فقط در دیتابیس سرور شناسه (hbbs) هستند و به API گزارش نمی‌دهند.

agent روی سرور hbbs ردیف‌های جدول peer را می‌فرستد (POST /api/agent/peers). برای هر شناسهٔ ناشناخته یک
`Client(legacy=True)` ساخته می‌شود تا در همان فهرست «کلاینت‌ها» دیده شود. کلاینتی که خودش به API گزارش می‌دهد
هرگز از روی این داده تغییر نمی‌کند.
"""

from django.utils import timezone

from .models import Client


def mark_online(ids: list[str]) -> int:
    """دستگاه‌های قدیمیِ آنلاین (از شنود agent): آخرین تماسشان الان است. کلاینتی که خودش heartbeat می‌دهد دست نمی‌خورد."""
    if not ids:
        return 0
    return Client.objects.filter(rd_id__in=ids, legacy=True).update(last_seen=timezone.now())


def import_peers(peers: list[dict]) -> dict:
    """peers: [{id, uuid_hash, ip, created_at}] اعتبارسنجی‌شده و بدون شناسهٔ تکراری."""
    existing = {c.rd_id: c for c in Client.objects.filter(rd_id__in=[p["id"] for p in peers])}
    hashes = {p["uuid_hash"] for p in peers if p["uuid_hash"]}
    # حکم مسدودسازی برای «ماشین» است (uuid)؛ ردیف تازه هم اگر ماشینش مسدود است مسدود بماند
    blocked = set(Client.objects.filter(uuid_hash__in=hashes, blocked=True).values_list("uuid_hash", flat=True))
    now = timezone.now()

    created, changed, skipped = [], [], 0
    for p in peers:
        c = existing.get(p["id"])
        if c is None:
            created.append(Client(
                rd_id=p["id"], uuid_hash=p["uuid_hash"], ip=p["ip"], first_seen=p["created_at"] or now,
                last_seen=None, legacy=True, blocked=p["uuid_hash"] in blocked,
            ))
        elif not c.legacy:
            skipped += 1  # خودش به API گزارش می‌دهد
        else:
            dirty = False
            if p["ip"] and p["ip"] != c.ip:
                c.ip, dirty = p["ip"], True
            if p["created_at"] and p["created_at"] != c.first_seen:
                c.first_seen, dirty = p["created_at"], True
            if p["uuid_hash"] and not c.uuid_hash:
                c.uuid_hash, dirty = p["uuid_hash"], True
            if dirty:
                changed.append(c)

    Client.objects.bulk_create(created, ignore_conflicts=True)
    if changed:
        Client.objects.bulk_update(changed, ["ip", "first_seen", "uuid_hash"])
    return {"created": len(created), "updated": len(changed), "skipped": skipped}
