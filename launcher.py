# ==================================================
# =============== CHUNK: LAUNCHER.PY ===============
# ==================================================
import os, sys, threading, time, webbrowser
from pathlib import Path

# Run from the folder that contains main.py
ROOT = Path(__file__).parent.resolve()
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from main import app  # FastAPI app
import uvicorn

HOST = os.environ.get("HOST", "127.0.0.1")
# If PORT not set, use 0 so OS chooses a free port (avoids WinError 10048)
REQUESTED_PORT = int(os.environ.get("PORT", "0"))

def main():
    config = uvicorn.Config(
        app,
        host=HOST,
        port=REQUESTED_PORT,   # 0 => OS chooses an open port
        log_level="info",
        reload=False,          # avoid Windows reloader child weirdness
    )
    server = uvicorn.Server(config)

    # Run server in a background thread so we can wait for "started"
    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    # Wait up to ~20s until server.started flips True or the thread dies
    for _ in range(200):
        if getattr(server, "started", False):
            break
        if not t.is_alive():
            print("[launcher] Server failed to start.")
            return
        time.sleep(0.1)

    if not getattr(server, "started", False):
        print("[launcher] Server did not report 'started'.")
        return

    # Discover the actual bound port from Uvicorn’s sockets
    bound_port = None
    try:
        for srv in getattr(server, "servers", []):
            for sock in getattr(srv, "sockets", []):
                try:
                    bound_port = sock.getsockname()[1]
                    if bound_port:
                        break
                except Exception:
                    pass
            if bound_port:
                break
    except Exception:
        pass

    if not bound_port:
        # Fallback (shouldn’t happen with modern uvicorn)
        bound_port = REQUESTED_PORT if REQUESTED_PORT else 8000

    url = f"http://{HOST}:{bound_port}"
    print(f"[launcher] Live at {url}")
    try:
        webbrowser.open_new(url)
    except Exception:
        pass

    # Keep foreground attached to the server
    t.join()

if __name__ == "__main__":
    main()
