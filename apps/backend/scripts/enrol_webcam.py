"""Enrol a face straight from the laptop webcam — no phone, no file juggling.

    python scripts/enrol_webcam.py --name "Sales"
    python scripts/enrol_webcam.py --list
    python scripts/enrol_webcam.py --test            # "who am I?" — no enrolment, no punch

Live preview opens; SPACE grabs the shot the prompt asks for, ESC aborts.
Three poses are taken (straight / slight left / slight right) because ArcFace
averages the samples — one frontal shot alone matches poorly at a door camera
where nobody looks straight at the lens.

Run with the face-worker venv, which already has opencv:
    apps/face-worker/.venv/Scripts/python.exe scripts/enrol_webcam.py --name "Sales"
"""

import argparse
import json
import mimetypes
import sys
import urllib.error
import urllib.request
import uuid

import cv2

POSES = [
    ("Look STRAIGHT at the camera", "straight"),
    ("Turn your head slightly LEFT", "left"),
    ("Turn your head slightly RIGHT", "right"),
]


def post(url, token, fields=None, files=None):
    """Minimal multipart POST — avoids depending on `requests` being installed."""
    boundary = uuid.uuid4().hex
    body = bytearray()
    for key, value in (fields or {}).items():
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
        ).encode()
    for key, (filename, data) in (files or {}).items():
        ctype = mimetypes.guess_type(filename)[0] or "image/jpeg"
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        body += data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(url, data=bytes(body), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"raw": e.read().decode("utf8", "ignore")[:300]}


def get_json(url, token):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def login(base, email, password):
    req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["accessToken"]


def capture(prompts):
    """Open the webcam and return one JPEG per prompt."""
    # CAP_DSHOW: the default MSMF backend on Windows takes several seconds to
    # open and sometimes returns black frames on built-in webcams.
    cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cam.isOpened():
        sys.exit("Cannot open the webcam. Close Teams/Zoom/Camera and retry.")
    cam.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cam.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    shots = []
    try:
        for label, _tag in prompts:
            while True:
                ok, frame = cam.read()
                if not ok:
                    sys.exit("Webcam stopped returning frames.")
                view = cv2.flip(frame, 1)  # mirror, so moving left looks left
                cv2.putText(view, label, (20, 45),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5)
                cv2.putText(view, label, (20, 45),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (60, 220, 60), 2)
                cv2.putText(view, f"SPACE = capture   ESC = quit   ({len(shots) + 1}/{len(prompts)})",
                            (20, view.shape[0] - 25),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
                cv2.imshow("enrolment", view)

                key = cv2.waitKey(1) & 0xFF
                if key == 27:
                    sys.exit("Aborted.")
                if key == 32:
                    # Store the UNMIRRORED frame — the mirror is only a UI aid.
                    ok, buf = cv2.imencode(".jpg", frame,
                                           [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                    if ok:
                        shots.append(buf.tobytes())
                        print(f"  captured {len(shots)}/{len(prompts)}")
                    break
    finally:
        cam.release()
        cv2.destroyAllWindows()
    return shots


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3001")
    ap.add_argument("--email", default="admin@tashfeen.com")
    ap.add_argument("--password", default="Admin@123456")
    ap.add_argument("--name", help="employee to enrol (partial name match)")
    ap.add_argument("--employee", help="employee UUID, instead of --name")
    ap.add_argument("--list", action="store_true", help="list employees and exit")
    ap.add_argument("--test", action="store_true", help="identify only, do not enrol")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    token = login(base, args.email, args.password)

    if args.list:
        emps = get_json(f"{base}/employees", token)
        emps = emps if isinstance(emps, list) else emps.get("data", [])
        print(f"\n  {len(emps)} employee(s):\n")
        for e in emps:
            print(f"  {e['id']}  {e['firstName']} {e['lastName']}  [{e.get('employeeCode') or '-'}]")
        print()
        return

    if args.test:
        shots = capture([("Look at the camera — WHO AM I?", "test")])
        if not shots:
            return
        status, body = post(f"{base}/attendance/face/identify", token,
                            files={"photo": ("webcam.jpg", shots[0])})
        if status != 200:
            print(f"\n  HTTP {status}: {body}\n")
            return
        if body.get("matched"):
            sim = body["similarity"]
            print(f"\n  MATCH: {body['name']} ({body.get('code')})   similarity {sim}")
            print("  Confident.\n" if sim >= 0.5 else
                  "  Weak (<0.50) — re-enrol with better light.\n")
        else:
            print("\n  NO MATCH — not enrolled, or the shot was poor.\n")
        return

    # --- resolve the employee ---
    employee_id = args.employee
    if not employee_id:
        if not args.name:
            sys.exit("Pass --name \"Firstname\" or --employee <uuid>. Try --list.")
        emps = get_json(f"{base}/employees", token)
        emps = emps if isinstance(emps, list) else emps.get("data", [])
        needle = args.name.lower()
        hits = [e for e in emps
                if needle in f"{e['firstName']} {e['lastName']}".lower()]
        if not hits:
            sys.exit(f'No employee matching "{args.name}". Try --list.')
        if len(hits) > 1:
            print(f'"{args.name}" is ambiguous:')
            for h in hits:
                print(f"  {h['id']}  {h['firstName']} {h['lastName']}")
            sys.exit(1)
        employee_id = hits[0]["id"]
        print(f"\n  enrolling: {hits[0]['firstName']} {hits[0]['lastName']}")

    print("  Opening the webcam — the preview window may be behind this one.\n")
    shots = capture(POSES)
    if not shots:
        sys.exit("No shots captured.")

    ok = 0
    for i, data in enumerate(shots, 1):
        status, body = post(f"{base}/attendance/face/enroll", token,
                            fields={"employeeId": employee_id},
                            files={"photo": (f"webcam{i}.jpg", data)})
        if status in (200, 201):
            ok += 1
            q = body.get("quality")
            print(f"  ok   shot {i}   quality {q}   samples {body.get('samples')}")
        else:
            print(f"  FAIL shot {i}   HTTP {status}   {body}")

    print(f"\n  enrolled {ok}/{len(shots)} shot(s).")
    if ok:
        print("  Now verify:  python scripts/enrol_webcam.py --test\n")


if __name__ == "__main__":
    main()
