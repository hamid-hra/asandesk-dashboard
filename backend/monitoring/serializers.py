import ipaddress
import re

from rest_framework import serializers

from .models import Alert

SERVICE_NAME = re.compile(r"^[a-z0-9_-]{1,16}$")
MAX_SERVICES = 8
MAX_PEERS = 1000


def _clamp_pct(v):
    return max(0.0, min(100.0, float(v)))


class IngestSerializer(serializers.Serializer):
    """داده‌ای که agent هر چند ثانیه ارسال می‌کند."""

    ts = serializers.DateTimeField(required=False)
    cpu = serializers.FloatField(min_value=0, max_value=100)
    ram = serializers.FloatField(min_value=0, max_value=100)
    ram_used = serializers.IntegerField(min_value=0, required=False, default=0)
    disk = serializers.FloatField(min_value=0, max_value=100)
    disk_used = serializers.IntegerField(min_value=0, required=False, default=0)
    net_rx_bps = serializers.IntegerField(min_value=0, required=False, default=0)
    net_tx_bps = serializers.IntegerField(min_value=0, required=False, default=0)
    net_pct = serializers.FloatField(min_value=0, required=False, default=0)
    tcp_established = serializers.IntegerField(min_value=0, required=False, default=0)
    load1 = serializers.FloatField(min_value=0, required=False, default=0)
    latency_ms = serializers.FloatField(min_value=0, required=False, allow_null=True, default=None)
    # مشخصات سخت‌افزار
    hostname = serializers.CharField(max_length=128, required=False, allow_blank=True)
    ip = serializers.CharField(max_length=64, required=False, allow_blank=True)
    cores = serializers.IntegerField(min_value=0, required=False)
    ram_total = serializers.IntegerField(min_value=0, required=False)
    disk_total = serializers.IntegerField(min_value=0, required=False)
    net_capacity_bps = serializers.IntegerField(min_value=0, required=False)
    agent_version = serializers.CharField(max_length=32, required=False, allow_blank=True)
    pubkey_fp = serializers.CharField(max_length=64, required=False, allow_blank=True)
    # سرویس‌هایی که agent پایش می‌کند (مثلاً hbbs/hbbr): {name: {up, uptime_s, cpu, ram}}
    services = serializers.DictField(child=serializers.DictField(), required=False)

    def validate_net_pct(self, v):
        return _clamp_pct(v)

    def validate_services(self, value):
        if len(value) > MAX_SERVICES:
            raise serializers.ValidationError("too many services")
        out = {}
        for name, s in value.items():
            if not SERVICE_NAME.match(name):
                raise serializers.ValidationError(f"bad service name: {name[:20]}")
            try:
                out[name] = {
                    "up": bool(s.get("up")),
                    "uptime_s": max(0, int(s.get("uptime_s") or 0)),
                    "cpu": round(_clamp_pct(s.get("cpu") or 0), 2),
                    "ram": max(0, int(s.get("ram") or 0)),
                }
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"bad values for {name}")
        return out


def clean_ip(value) -> str:
    """IP معتبر یا رشتهٔ خالی؛ پیشوند ::ffff: (IPv4 روی سوکت IPv6) برداشته می‌شود."""
    text = str(value or "").strip()
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return ""
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return str(ip)


class PeerSerializer(serializers.Serializer):
    """یک ردیف از جدول peer دیتابیس hbbs که agent می‌فرستد."""

    id = serializers.RegexField(r"^[A-Za-z0-9_-]{4,32}$")
    # sha256 رشتهٔ base64 دادهٔ uuid؛ همان چیزی که کلاینت در heartbeat می‌فرستد و پنل از آن hash می‌گیرد
    uuid_hash = serializers.RegexField(r"^[0-9a-f]{64}$", required=False, allow_blank=True, default="")
    ip = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    created_at = serializers.DateTimeField(required=False, allow_null=True, default=None)

    def validate_ip(self, value):
        return clean_ip(value)


class LogLineSerializer(serializers.Serializer):
    ts = serializers.CharField(max_length=40, allow_blank=True)
    stream = serializers.ChoiceField(choices=["out", "err", "meta"], default="out")
    text = serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False)


class ServiceLogSerializer(serializers.Serializer):
    container = serializers.CharField(max_length=64, allow_blank=True, default="")
    error = serializers.CharField(max_length=300, allow_blank=True, default="")
    lines = LogLineSerializer(many=True, allow_empty=True, default=list)

    def validate_lines(self, value):
        if len(value) > 600:
            raise serializers.ValidationError("at most 600 lines per service")
        return value


class LogsSerializer(serializers.Serializer):
    """لاگ کانتینرهای سرویس‌ها (hbbs/hbbr) که agent از فایل json-file داکر می‌خواند."""

    services = serializers.DictField(child=ServiceLogSerializer())

    def validate_services(self, value):
        if len(value) > MAX_SERVICES or any(not SERVICE_NAME.match(k) for k in value):
            raise serializers.ValidationError("bad services")
        return value


class OnlineSerializer(serializers.Serializer):
    """شناسه‌های دستگاه‌هایی که agent در چند ثانیهٔ اخیر ثبت‌نام‌شان را در hbbs دیده است."""

    ids = serializers.ListField(child=serializers.RegexField(r"^[A-Za-z0-9_-]{4,32}$"), allow_empty=True, max_length=MAX_PEERS * 5)


class PeersSerializer(serializers.Serializer):
    peers = PeerSerializer(many=True, allow_empty=True)

    def validate_peers(self, value):
        if len(value) > MAX_PEERS:
            raise serializers.ValidationError(f"at most {MAX_PEERS} peers per request")
        return value


class AlertSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source="server.name", default="", read_only=True)

    class Meta:
        model = Alert
        fields = ("id", "level", "kind", "title", "detail", "server_name", "opened_at", "resolved_at")
