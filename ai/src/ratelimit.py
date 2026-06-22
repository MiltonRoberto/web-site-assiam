import time
from collections import defaultdict
from threading import Lock

_store: dict[str, list[float]] = defaultdict(list)
_lock = Lock()

MAX_REQUESTS = 20
WINDOW_SECONDS = 60


def is_allowed(ip: str) -> bool:
    """Retorna True se o IP ainda está dentro do limite de requisições."""
    now = time.time()
    with _lock:
        _store[ip] = [t for t in _store[ip] if now - t < WINDOW_SECONDS]
        if len(_store[ip]) >= MAX_REQUESTS:
            return False
        _store[ip].append(now)
        return True
