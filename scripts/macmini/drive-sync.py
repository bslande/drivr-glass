#!/usr/bin/env python3
"""Drive-start listener for the Drivr cabin task board.

Runs on Bud's Mac mini (launchd). When TeslaMate MQTT reports a drive start
(state=driving or shift_state D/R), or when the parked-test topic
drivr/board/refresh is published, this script POSTs /tasks/refresh so an
open glass page gets an SSE "tasks" event.

This job never PUTs task-board.json. Full board replace is a single-owner
path (scripts/sync-task-board.sh). Bots should PATCH /s/<id>/tasks/<id>.

The bearer token and glass session URL are read from mode-600 sibling files
PUSH_TOKEN.local and GLASS_URL.local. They are never printed. MQTT stays on
the TeslaMate Docker network; this process uses `docker exec` and does not
publish port 1883 to the host or Tailscale.

Usage:
  drive-sync.py           # subscribe and run until killed
  drive-sync.py --now     # one parked-safe refresh, then exit
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

DIR = Path(__file__).resolve().parent
TOKEN_FILE = DIR / "PUSH_TOKEN.local"
URL_FILE = DIR / "GLASS_URL.local"

MQTT_CONTAINER = os.environ.get("DRIVR_MQTT_CONTAINER", "teslamate-mosquitto-1")
STATE_TOPIC = "teslamate/cars/1/state"
SHIFT_TOPIC = "teslamate/cars/1/shift_state"
TEST_TOPIC = "drivr/board/refresh"
COOLDOWN_SEC = 60
BACKOFF_START_SEC = 2
BACKOFF_MAX_SEC = 60
DOCKER = os.environ.get("DOCKER", "/usr/local/bin/docker")
CURL = os.environ.get("CURL", "/usr/bin/curl")


def log(msg: str) -> None:
    now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
    print(f"{now} {msg}", flush=True)


def load_token() -> str:
    if not TOKEN_FILE.is_file():
        raise SystemExit("missing PUSH_TOKEN.local next to drive-sync.py")
    token = TOKEN_FILE.read_text().strip()
    if not token:
        raise SystemExit("PUSH_TOKEN.local is empty")
    return token


def load_base_url() -> str:
    if not URL_FILE.is_file():
        raise SystemExit("missing GLASS_URL.local next to drive-sync.py")
    url = URL_FILE.read_text().strip().rstrip("/")
    if not url.startswith("https://"):
        raise SystemExit("GLASS_URL.local is not an https session URL")
    return url


def request_json(
    method: str,
    url: str,
    token: str,
    body: Optional[bytes] = None,
    timeout: int = 20,
) -> tuple[int, Any]:
    """Call the Worker with curl (macOS SecureTransport). Token stays off argv."""
    tmp = Path(tempfile.mkdtemp(prefix="drivr-board-http-"))
    try:
        os.chmod(tmp, 0o700)
        header_file = tmp / "headers"
        header_lines = [
            "Authorization: Bearer " + token,
            "Accept: application/json",
        ]
        if body is not None:
            header_lines.append("Content-Type: application/json")
        header_file.write_text("\n".join(header_lines) + "\n")
        os.chmod(header_file, 0o600)
        body_file = tmp / "body"
        if body is not None:
            body_file.write_bytes(body)
            os.chmod(body_file, 0o600)
        out_file = tmp / "out"
        config = [
            f'url = "{url}"',
            "silent",
            "show-error",
            "connect-timeout = 10",
            f"max-time = {timeout}",
            f'request = "{method}"',
            f'header = "@{header_file}"',
            f'output = "{out_file}"',
        ]
        if body is not None:
            config.append(f'data = "@{body_file}"')
        proc = subprocess.run(
            [CURL, "-K", "-", "-w", "%{http_code}"],
            input="\n".join(config) + "\n",
            capture_output=True,
            text=True,
            timeout=timeout + 5,
        )
        code_s = (proc.stdout or "").strip()
        try:
            code = int(code_s)
        except ValueError:
            code = 0
        raw = out_file.read_bytes() if out_file.is_file() else b""
        if not raw:
            return code, None
        try:
            return code, json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return code, None
    except (OSError, subprocess.TimeoutExpired, subprocess.SubprocessError):
        return 0, None
    finally:
        try:
            for child in tmp.iterdir():
                try:
                    child.unlink()
                except OSError:
                    pass
            tmp.rmdir()
        except OSError:
            pass


def refresh(base: str, token: str) -> int:
    # Never PUT a local task-board.json from this job, stale or not.
    code, body = request_json("POST", base + "/tasks/refresh", token, body=b"{}")
    count = body.get("count") if isinstance(body, dict) else "?"
    log(f"POST /tasks/refresh -> HTTP {code} count={count}")
    return 0 if code == 200 else 1


def in_gear(payload: str) -> bool:
    return payload.strip() in ("D", "R")


def not_in_gear(payload: str) -> bool:
    p = payload.strip()
    if p == "" or p.lower() in {"nil", "null", "none"}:
        return True
    return p.upper() == "P"


class ListenerState:
    """Persists across MQTT reconnects inside this process."""

    def __init__(self) -> None:
        self.prev_state: Optional[str] = None
        self.prev_shift: Optional[str] = None
        self.seeded_state = False
        self.seeded_shift = False
        self.last_fire = 0.0

    def seed_state(self, payload: str) -> None:
        self.prev_state = payload
        self.seeded_state = True

    def seed_shift(self, payload: str) -> None:
        self.prev_shift = payload
        self.seeded_shift = True


def parse_topic_line(line: str) -> tuple[str, str]:
    line = line.strip()
    if " " not in line:
        return line, ""
    topic, payload = line.split(" ", 1)
    return topic, payload


def rising_drive_start(topic: str, payload: str, state: ListenerState) -> str:
    """Return a reason to fire, or empty if this is only a seed or not a start.

    Fires on whichever rising edge comes first: state=driving or shift D/R.
    First message for each topic seeds previous values and does not fire.
    """
    if topic == TEST_TOPIC:
        return "test topic"
    if topic == STATE_TOPIC:
        if not state.seeded_state:
            state.seed_state(payload)
            return ""
        started = payload.strip() == "driving" and state.prev_state != "driving"
        state.prev_state = payload
        return "drive start (state)" if started else ""
    if topic == SHIFT_TOPIC:
        if not state.seeded_shift:
            state.seed_shift(payload)
            return ""
        started = in_gear(payload) and not in_gear(state.prev_shift or "")
        # empty / nil / P are not in gear; already handled by in_gear().
        _ = not_in_gear(payload)
        state.prev_shift = payload
        return "drive start (shift)" if started else ""
    return ""


def mosquitto_cmd(*extra: str) -> list[str]:
    return [
        DOCKER,
        "exec",
        "-i",
        MQTT_CONTAINER,
        "mosquitto_sub",
        "-t",
        STATE_TOPIC,
        "-t",
        SHIFT_TOPIC,
        "-t",
        TEST_TOPIC,
        "-v",
        *extra,
    ]


def seed_from_retained(state: ListenerState) -> None:
    """Read retained current values (no -R) to seed prev_* without firing."""
    try:
        proc = subprocess.run(
            mosquitto_cmd("-W", "2"),
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.SubprocessError) as exc:
        log(f"retained seed skipped ({type(exc).__name__})")
        return
    for raw in (proc.stdout or "").splitlines():
        topic, payload = parse_topic_line(raw)
        if topic == STATE_TOPIC and not state.seeded_state:
            state.seed_state(payload)
        elif topic == SHIFT_TOPIC and not state.seeded_shift:
            state.seed_shift(payload)
    bits = []
    if state.seeded_state:
        bits.append("state")
    if state.seeded_shift:
        bits.append("shift")
    log("seeded previous values from retained MQTT: " + (", ".join(bits) if bits else "none"))


def subscribe_live(state: ListenerState, base: str, token: str) -> int:
    """Subscribe without retained leftovers (-R). Return process exit or 1."""
    log("subscribing to TeslaMate MQTT via docker exec (-R, no host port publish)")
    try:
        proc = subprocess.Popen(
            mosquitto_cmd("-R"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        log(f"docker exec failed to start: {exc}")
        return 1

    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            topic, payload = parse_topic_line(line)
            if not topic:
                continue
            reason = rising_drive_start(topic, payload, state)
            if not reason:
                continue
            now = time.time()
            if now - state.last_fire < COOLDOWN_SEC:
                log("drive-start or test poke ignored (cooldown)")
                continue
            state.last_fire = now
            log(f"trigger: {reason}")
            refresh(base, token)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if proc.returncode not in (0, None):
            log(f"mosquitto_sub exited {proc.returncode}")
    return proc.returncode if proc.returncode not in (0, None) else 1


def listen() -> int:
    token = load_token()
    base = load_base_url()
    state = ListenerState()
    backoff = BACKOFF_START_SEC
    while True:
        started = time.time()
        seed_from_retained(state)
        subscribe_live(state, base, token)
        # Keep cooldown and prev_* across reconnects; only the socket is new.
        if time.time() - started > 60:
            backoff = BACKOFF_START_SEC
        log(f"mqtt disconnected; reconnecting in {backoff}s (state preserved)")
        time.sleep(backoff)
        backoff = min(backoff * 2, BACKOFF_MAX_SEC)


def main(argv: list[str]) -> int:
    if "--now" in argv:
        log("parked test refresh (--now); no local PUT")
        return refresh(load_base_url(), load_token())
    return listen()


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
