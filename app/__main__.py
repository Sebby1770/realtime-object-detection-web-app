"""Run the console: python -m app [--host 127.0.0.1] [--port 8000] [--reload] [--mock]."""

from __future__ import annotations

import argparse
import os
import sys


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app", description="Realtime object detection console.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default 127.0.0.1).")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default 8000).")
    parser.add_argument("--reload", action="store_true", help="Reload on code changes (development).")
    parser.add_argument("--mock", action="store_true", help="Use the simulated detector instead of YOLO.")
    args = parser.parse_args(argv)

    if args.mock:
        os.environ["YOLO_MOCK"] = "1"

    host = args.host.strip("[]")
    if host not in {"127.0.0.1", "localhost", "::1", "0.0.0.0", "::"} and "ALLOWED_HOSTS" not in os.environ:
        name = f"[{host}]" if ":" in host else host
        os.environ["ALLOWED_HOSTS"] = f"localhost,127.0.0.1,[::1],{name}"
    if host in {"0.0.0.0", "::"} and "ALLOWED_HOSTS" not in os.environ:
        print(
            "Listening on every interface. Other devices are refused until you set ALLOWED_HOSTS "
            "to the address they use, for example ALLOWED_HOSTS=localhost,192.168.1.20",
            file=sys.stderr,
        )

    import uvicorn

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
