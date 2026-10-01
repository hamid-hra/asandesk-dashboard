from rest_framework import serializers

from .models import Client, ClientSession


class ClientRowSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    location = serializers.CharField(read_only=True)
    online = serializers.BooleanField(read_only=True)

    class Meta:
        model = Client
        fields = (
            "id", "rid", "display_name", "name", "hostname", "os", "version",
            "ip", "location", "online", "blocked", "first_seen", "last_seen",
        )


class SessionSerializer(serializers.ModelSerializer):
    duration_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = ClientSession
        fields = (
            "id", "conn_id", "peer_id", "peer_name", "conn_type", "ip",
            "started_at", "ended_at", "duration_seconds", "bytes_in", "bytes_out",
        )


class ClientDetailSerializer(ClientRowSerializer):
    sessions = serializers.SerializerMethodField()
    sessions_total = serializers.SerializerMethodField()
    cpu = serializers.CharField(read_only=True)
    memory = serializers.CharField(read_only=True)

    class Meta(ClientRowSerializer.Meta):
        fields = ClientRowSerializer.Meta.fields + (
            "cpu", "memory", "country", "city", "created_at", "sessions", "sessions_total",
        )

    def get_sessions(self, obj):
        return SessionSerializer(obj.sessions.all()[:50], many=True).data

    def get_sessions_total(self, obj):
        return obj.sessions.count()
