"""Small transport boundary for the personal-key Dungeon Master endpoints."""

from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

MAX_DM_BODY = 100_000


class DMRequestGuard:
    """Reject cross-origin/browser requests and cap bodies before JSON decoding.

    Keys are deliberately absent from this middleware's state and diagnostics.
    No CORS permission is granted: the UI and API must share an origin (the Vite
    development proxy also preserves the browser's Host header).
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/dm/"):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)

        async def private_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = [
                    *message.get("headers", []),
                    (b"cache-control", b"no-store"),
                    (b"pragma", b"no-cache"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"same-origin"),
                ]
            await send(message)

        async def reject(status, detail):
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, private_send)

        origin = headers.get("origin")
        if headers.get("sec-fetch-site") == "cross-site":
            await reject(403, "Open Dungeon Master from this app's own address.")
            return
        if origin:
            try:
                parsed = urlsplit(origin)
                matches = (
                    parsed.scheme == scope["scheme"]
                    and parsed.netloc.lower() == headers.get("host", "").lower()
                    and not parsed.path
                    and not parsed.query
                    and not parsed.fragment
                )
            except ValueError:
                matches = False
            if not matches:
                await reject(403, "Open Dungeon Master from this app's own address.")
                return

        try:
            declared = int(headers.get("content-length", "0"))
        except ValueError:
            await reject(400, "Invalid request length.")
            return
        if declared > MAX_DM_BODY or declared < 0:
            await reject(
                413, "The campaign request is too large. Export it and start a new chapter."
            )
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_DM_BODY:
                await reject(
                    413, "The campaign request is too large. Export it and start a new chapter."
                )
                return
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, private_send)
