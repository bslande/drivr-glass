#!/usr/bin/env python3
"""Drive-start listener for the Drivr cabin task board.

Runs on Bud's Mac mini (launchd). When TeslaMate MQTT reports a drive start
(state=driving or shift_state D/R), or when the parked-test topic
drivr/board/refresh is published, this script:

  1. Optionally PUTs ~/drivr-glass/task-board.json if that file's updatedAt
     is newer than the Worker board (avoids overwriting a newer Worker store).
  2. POSTs /tasks/refresh so open glass pages get an SSE "tasks" event.
     The glass also polls GET /tasks while it is open.

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

DIR = Path(__file__).resolve().parent
TOKEN_FILE = DIR / "PUSH_TOKEN.local"
URL_FILE = DIR / "GLASS_URL.local"
BOARD_FILE = DIR / "task-board.json"

MQTT_CONTAINER = os.environ.get("DRIVR_MQTT_CONTAINER", "teslamate-mosquitto-1")
STATE_TOPIC = "teslamate/cars/1/state"
SHIFT_TOPIC = "teslamate/cars/1/shift_state"
TEST_TOPIC = "drivr/board/refresh"
COOLDOWN_SEC = 60
DOCKER = os.environ.get("DOCKER", "/usr/local/bin/docker")


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
    # Do not log or return anything beyond the in-memory URL.
    return url


def parse_iso(value: str) -> Optional[datetime]:
    try:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        return None


CURL = os.environ.get("CURL", "/usr/bin/curl")

def request_json(
    method: str,
    url: str,
    token: str,
    body: Optional[bytes] = None,
    timeout: int = 20,
) -> tuple[int, Any]:
    """Call the Worker with curl (macOS SecureTransport). Token stays off argv."""
    # python.org's urllib on this Mac lacks a CA bundle (CERTIFICATE_VERIFY_FAILED).
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
            f"connect-timeout = 10",
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


def maybe_put_local_board(base: str, token: str) -> None:
    if not BOARD_FILE.is_file():
        log("no local task-board.json; leaving Worker board unchanged")
        return
    try:
        local = json.loads(BOARD_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        log("local task-board.json unreadable; skipping PUT")
        return
    if not isinstance(local, dict) or not isinstance(local.get("tasks"), list):
        log("local task-board.json is not a board; skipping PUT")
        return
    local_at = parse_iso(str(local.get("updatedAt") or ""))
    code, remote = request_json("GET", base + "/tasks", token)
    if code != 200 or not isinstance(remote, dict):
        log(f"GET /tasks failed ({code}); skipping PUT")
        return
    remote_at = parse_iso(str(remote.get("updatedAt") or ""))
    if local_at is None:
        log("local board has no updatedAt; skipping PUT")
        return
    if remote_at is not None and local_at <= remote_at:
        log("local board is not newer than Worker; skipping PUT")
        return
    if "updatedAt" not in local:
        local = dict(local)
        local["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    payload = json.dumps(local, separators=(",", ":")).encode("utf-8")
    put_code, put_body = request_json("PUT", base + "/tasks", token, body=payload)
    count = put_body.get("count") if isinstance(put_body, dict) else "?"
    log(f"PUT /tasks -> HTTP {put_code} count={count}")


def refresh(base: str, token: str) -> int:
    maybe_put_local_board(base, token)
    code, body = request_json("POST", base + "/tasks/refresh", token, body=b"{}")
    count = body.get("count") if isinstance(body, dict) else "?"
    log(f"POST /tasks/refresh -> HTTP {code} count={count}")
    return 0 if code == 200 else 1


def is_drive_start(topic: str, payload: str, prev_state: str, prev_shift: str) -> bool:
    if topic == TEST_TOPIC:
        return True
    if topic == STATE_TOPIC and payload == "driving" and prev_state != "driving":
        return True
    if topic == SHIFT_TOPIC and payload in ("D", "R") and prev_shift not in ("D", "R"):
        return True
    return False


def listen() -> int:
    token = load_token()
    base = load_base_url()
    cmd = [
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
    ]
    log("subscribing to TeslaMate MQTT via docker exec (no host port publish)")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        log(f"docker exec failed to start: {exc}")
        return 1

    prev_state = ""
    prev_shift = ""
    last_fire = 0.0
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            if " " not in line:
                topic, payload = line, ""
            else:
                topic, payload = line.split(" ", 1)
            if topic == STATE_TOPIC:
                drive = is_drive_start(topic, payload, prev_state, prev_shift)
                prev_state = payload
            elif topic == SHIFT_TOPIC:
                drive = is_drive_start(topic, payload, prev_state, prev_shift)
                prev_shift = payload
            elif topic == TEST_TOPIC:
                drive = True
            else:
                continue
            now = time.time()
            if not drive:
                continue
            if now - last_fire < COOLDOWN_SEC:
                log("drive-start or test poke ignored (cooldown)")
                continue
            last_fire = now
            reason = "test topic" if topic == TEST_TOPIC else "drive start"
            log(f"trigger: {reason}")
            refresh(base, token)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        err = ""
        if proc.stderr is not None:
            try:
                err = proc.stderr.read().strip()
            except Exception:
                err = ""
        if proc.returncode not in (0, None) and err:
            # stderr from docker/mosquitto should not contain our token.
            log(f"mosquitto_sub exited {proc.returncode}")
    return 0


def main(argv: list[str]) -> int:
    if "--now" in argv:
        log("parked test refresh (--now)")
        return refresh(load_base_url(), load_token())
    return listen()


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)
