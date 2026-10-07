from rest_framework.response import Response
from rest_framework.views import APIView

from .version import CHANGELOG, VERSION


class VersionView(APIView):
    """Panel version and changelog. Any signed-in user can read it."""

    def get(self, request):
        return Response(
            {
                "version": VERSION,
                "changelog": [
                    {
                        "version": e["version"],
                        "date": e["date"],
                        "title": e["title"],
                        "items": [{"type": t, "text": text} for t, text in e["items"]],
                    }
                    for e in CHANGELOG
                ],
            }
        )
