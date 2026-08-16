#!/usr/bin/env python3
"""Read one JSON request from stdin and emit one JSON extraction result.

Agent-Reach is a capability/installation layer rather than a server API. Its
current YouTube backend is yt-dlp, which this isolated worker invokes directly.
No shell is used, no media is downloaded, and no CAPTCHA bypass is attempted.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.parse
import urllib.request
from typing import Any

MAX_CAPTION_BYTES = 5 * 1024 * 1024
ALLOWED_HOSTS = {"youtube.com", "youtu.be"}
ALLOWED_CAPTION_HOST_SUFFIXES = (".youtube.com", ".googlevideo.com")


def fail(code: str, message: str, exit_code: int = 1) -> None:
    print(json.dumps({"error": {"code": code, "message": message}}))
    raise SystemExit(exit_code)


def validate_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlparse(value)
    except ValueError:
        fail("INVALID_URL", "Malformed YouTube URL")
    hostname = (parsed.hostname or "").lower()
    youtube_host = hostname in ALLOWED_HOSTS or hostname.endswith(".youtube.com")
    if parsed.scheme != "https" or not youtube_host:
        fail("INVALID_URL", "Only HTTPS YouTube URLs are accepted")
    return value


def select_caption_url(metadata: dict[str, Any]) -> str | None:
    automatic = metadata.get("automatic_captions") or {}
    manual = metadata.get("subtitles") or {}
    for source in (manual, automatic):
        language_keys = sorted(
            source.keys(),
            key=lambda key: (0 if key == "en" else 1 if key.startswith("en") else 2, key),
        )
        for language in language_keys:
            formats = source.get(language) or []
            for item in formats:
                if item.get("ext") == "json3" and item.get("url"):
                    return str(item["url"])
    return None


def fetch_caption_chunks(url: str) -> list[dict[str, Any]]:
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (
        hostname in {"youtube.com", "googlevideo.com"}
        or hostname.endswith(ALLOWED_CAPTION_HOST_SUFFIXES)
    ):
        raise ValueError("Caption URL host is not allowlisted")
    request = urllib.request.Request(url, headers={"User-Agent": "TubeClickPro-Worker/0.1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_CAPTION_BYTES + 1)
    if len(body) > MAX_CAPTION_BYTES:
        raise ValueError("Caption response exceeded the configured size limit")
    payload = json.loads(body.decode("utf-8"))
    chunks: list[dict[str, Any]] = []
    for event in payload.get("events", []):
        segments = event.get("segs") or []
        text = "".join(str(segment.get("utf8", "")) for segment in segments).strip()
        if not text or text == "\n":
            continue
        chunks.append(
            {
                "startSeconds": float(event.get("tStartMs", 0)) / 1000,
                "durationSeconds": float(event.get("dDurationMs", 0)) / 1000,
                "text": " ".join(text.split()),
            }
        )
    return chunks


def nullable_number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) else None


def main() -> None:
    try:
        request = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        fail("INVALID_INPUT", "Worker input must be valid JSON")

    mode = request.get("mode")
    if mode not in {"basic", "deep"}:
        fail("INVALID_MODE", "mode must be basic or deep")
    video_url = validate_url(str(request.get("videoUrl", "")))

    command = [
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout",
        "20",
        video_url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode != 0:
        combined = (completed.stderr + completed.stdout).lower()
        if "captcha" in combined or "sign in to confirm" in combined or "challenge" in combined:
            fail("UPSTREAM_CHALLENGE", "YouTube requested human verification; no bypass was attempted")
        if "403" in combined or "forbidden" in combined:
            fail("UPSTREAM_FORBIDDEN", "YouTube rejected the extraction request")
        fail("EXTRACTION_FAILED", completed.stderr.strip()[-500:] or "yt-dlp extraction failed")

    try:
        metadata = json.loads(completed.stdout)
    except json.JSONDecodeError:
        fail("INVALID_UPSTREAM_OUTPUT", "yt-dlp did not return valid JSON")

    warnings: list[str] = []
    transcript: list[dict[str, Any]] = []
    caption_url = select_caption_url(metadata)
    if caption_url:
        try:
            transcript = fetch_caption_chunks(caption_url)
        except Exception as error:  # isolated worker returns a warning, not raw internals
            warnings.append(f"caption_unavailable:{type(error).__name__}")
    else:
        warnings.append("caption_track_not_found")

    hook_window = [chunk for chunk in transcript if chunk["startSeconds"] < 10.0] if mode == "deep" else []
    if mode == "basic":
        transcript = [chunk for chunk in transcript if chunk["startSeconds"] < 30.0]

    result = {
        "source": "agent-reach/yt-dlp",
        "mode": mode,
        "video": {
            "id": str(metadata.get("id") or ""),
            "title": str(metadata.get("title") or "Untitled video"),
            "channel": metadata.get("channel") if isinstance(metadata.get("channel"), str) else None,
            "durationSeconds": nullable_number(metadata.get("duration")),
            "viewCount": nullable_number(metadata.get("view_count")),
            "publishedAt": metadata.get("upload_date") if isinstance(metadata.get("upload_date"), str) else None,
            "description": metadata.get("description") if isinstance(metadata.get("description"), str) else None,
            "thumbnailUrl": metadata.get("thumbnail") if isinstance(metadata.get("thumbnail"), str) else None,
        },
        "transcript": transcript,
        "hookWindow": hook_window,
        "warnings": warnings,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except subprocess.TimeoutExpired:
        fail("EXTRACTION_TIMEOUT", "yt-dlp exceeded the worker timeout")
