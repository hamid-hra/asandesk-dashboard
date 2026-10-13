import logging

from .routes import FALLBACK_ACTION, ROUTES, render
from .service import record

log = logging.getLogger(__name__)

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
MISSING = object()


class ActivityMiddleware:
    """Write the activity log for panel API calls made by a signed-in person.

    Only the method, the route and the numbers in the URL are used. The request body is never read,
    so a password can not end up in the log.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def process_view(self, request, view_func, view_args, view_kwargs):
        cls = getattr(view_func, "cls", None)  # APIView.as_view() puts the class here
        request._activity_view = (cls, dict(view_kwargs)) if cls else None
        return None

    def __call__(self, request):
        response = self.get_response(request)
        try:
            self._log(request, response)
        except Exception:  # noqa: BLE001 — logging must never turn a good response into an error
            log.exception("activity middleware failed")
        return response

    def _log(self, request, response):
        user = getattr(request, "user", None)
        view = getattr(request, "_activity_view", None)
        if not (user and user.is_authenticated and view):
            return
        cls, kw = view
        spec = ROUTES.get((f"{cls.__module__.split('.')[0]}.{cls.__name__}", request.method), MISSING)
        noted = getattr(request, "activity_note", None)
        if spec is None and not noted:
            return  # deliberately not logged
        if spec is MISSING:
            if request.method not in MUTATING and not noted:
                return  # reads are not logged unless listed
            spec = (FALLBACK_ACTION, None)

        code = response.status_code
        if code == 403:
            ok = False
        elif code >= 400:
            return  # a rejected or failed request changed nothing
        else:
            ok = True

        action, label = spec if spec else (FALLBACK_ACTION, None)
        data = response.data if isinstance(getattr(response, "data", None), dict) else {}
        generic = f"{request.method} {request.path}"
        if noted:
            action = noted[0] or action
            text = noted[1]
        else:
            text = render(label, kw, data, generic)
        if not ok:
            text = f"دسترسی نداشت: {text}"
        record(action, text, request=request, ok=ok)
