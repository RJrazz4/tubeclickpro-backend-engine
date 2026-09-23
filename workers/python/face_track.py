#!/usr/bin/env python3
"""
Face-center extraction for the zero-cost clipper (YuNet via OpenCV).

Reads a video segment and emits the largest face's centre per sampled frame as
JSON: {"centers": [{"t","x","y"}...], "sampleFps": N, "width": W, "height": H}.
Times are relative to --start (the trimmed clip start), so they line up with the
ffmpeg render. On any error (no OpenCV, no model, unreadable video) it prints an
empty centers array so the caller falls back to a static center crop.

Usage:
  face_track.py --video PATH --model PATH [--start S] [--duration D]
                [--fps 6] [--min-conf 0.6] [--max-input 640]
"""
import argparse
import json
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--fps", type=float, default=6.0, help="target sample rate (frames/sec)")
    ap.add_argument("--min-conf", type=float, default=0.6)
    ap.add_argument("--max-input", type=int, default=640)
    args = ap.parse_args()

    try:
        import cv2  # noqa
    except Exception as e:  # OpenCV not installed -> graceful fallback
        emit({"centers": [], "error": "opencv-unavailable: %s" % e})
        return

    try:
        cap = cv2.VideoCapture(args.video)
        if not cap.isOpened():
            emit({"centers": [], "error": "cannot-open"})
            return

        src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if src_fps <= 0:
            src_fps = 30.0
        W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

        detector = cv2.FaceDetectorYN.create(
            args.model, "", (args.max_input, args.max_input), args.min_conf, 0.3, 5000
        )

        # Seek to the clip start; sample at ~args.fps until start+duration.
        if args.start > 0:
            cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000.0)
        interval = max(1, int(round(src_fps / args.fps))) if args.fps > 0 else 1
        end_ms = (args.start + args.duration) * 1000.0

        centers = []
        last = None
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
            if t_ms > end_ms:
                break
            if idx % interval == 0:
                h, w = frame.shape[:2]
                scale = min(1.0, args.max_input / float(max(w, h))) if max(w, h) > 0 else 1.0
                small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame
                detector.setInputSize((small.shape[1], small.shape[0]))
                _, faces = detector.detect(small)
                t_rel = max(0.0, (t_ms / 1000.0) - args.start)
                if faces is not None and len(faces) > 0:
                    best = max(faces, key=lambda f: f[2] * f[3])  # largest face
                    cx = (best[0] + best[2] / 2.0) / scale
                    cy = (best[1] + best[3] / 2.0) / scale
                    last = (float(cx), float(cy))
                    centers.append({"t": round(t_rel, 3), "x": round(float(cx), 1), "y": round(float(cy), 1)})
                elif last is not None:
                    # carry the last known face so the camera stays put on misses
                    centers.append({"t": round(t_rel, 3), "x": round(last[0], 1), "y": round(last[1], 1)})
            idx += 1

        cap.release()
        sample_fps = (src_fps / interval) if interval > 0 else src_fps
        emit({"centers": centers, "sampleFps": round(sample_fps, 3), "width": W, "height": H})
    except Exception as e:  # never hard-fail the render
        emit({"centers": [], "error": str(e)})


if __name__ == "__main__":
    main()
