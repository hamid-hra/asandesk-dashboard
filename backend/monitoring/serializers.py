from rest_framework import serializers

from .models import Alert


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

    def validate_net_pct(self, v):
        return _clamp_pct(v)


class AlertSerializer(serializers.ModelSerializer):
    server_name = serializers.CharField(source="server.name", default="", read_only=True)

    class Meta:
        model = Alert
        fields = ("id", "level", "kind", "title", "detail", "server_name", "opened_at", "resolved_at")
