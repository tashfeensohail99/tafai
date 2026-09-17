#!/usr/bin/env bash
# Grab a live still from any NVR channel — and optionally ask the attendance
# system to identify whoever is in it.
#
#   bash scripts/nvr-snap.sh 9              # save a still from channel 9
#   bash scripts/nvr-snap.sh 9 --identify   # ... and run recognition on it
#   bash scripts/nvr-snap.sh all            # every channel, to see what each covers
#
# This bypasses the NVR's event push entirely, so it works even while the
# alarm-server image attachment is still unresolved. It is the fastest way to
# answer "would a face at this camera actually match?" — stand in front of the
# camera, run it with --identify, read the similarity.

set -uo pipefail

NVR="${NVR_HOST:-192.168.18.16}"
CRED="${NVR_CRED:-admin:hik@1122}"
API="${API_URL:-http://localhost:3001}"
EMAIL="${API_EMAIL:-admin@tashfeen.com}"
PASS="${API_PASS:-Admin@123456}"
OUT="${SNAP_DIR:-$HOME/Desktop/nvr-shots}"

CURL=curl.exe; command -v "$CURL" >/dev/null 2>&1 || CURL=curl
mkdir -p "$OUT"

CH="${1:?usage: nvr-snap.sh <channel|all> [--identify]}"
IDENT=""; [ "${2:-}" = "--identify" ] && IDENT=1

snap() {
  # Two statements deliberately: in a single `local a=.. b=$a..` the expansion
  # of $a happens before it is assigned, which trips `set -u`.
  local ch="$1"
  local f="$OUT/ch${ch}.jpg"
  # Stream id is <channel><stream>, e.g. channel 9 main stream = 901.
  "$CURL" -sS --max-time 20 --digest -u "$CRED" \
    -o "$f" "http://$NVR/ISAPI/Streaming/channels/${ch}01/picture" 2>/dev/null
  local sz; sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$sz" -lt 5000 ]; then
    echo "  ch$ch  FAILED (${sz}b) — channel offline?"
    return 1
  fi
  echo "  ch$ch  $f  (${sz}b)"
}

identify() {
  local f="$OUT/ch${1}.jpg"
  local tok
  tok=$("$CURL" -sS -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$API/auth/login" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).accessToken)}catch{console.log('')}})")
  [ -z "$tok" ] && { echo "     (login failed — is the backend up?)"; return 1; }
  "$CURL" -sS --max-time 60 -H "Authorization: Bearer $tok" \
    -F "photo=@$f" "$API/attendance/face/identify" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        let j; try{j=JSON.parse(s)}catch{return console.log('     bad reply: '+s.slice(0,120))}
        if(j.matched) console.log('     MATCH: '+j.name+'  similarity '+j.similarity+(j.similarity>=0.5?'  (confident)':'  (WEAK — move the camera closer or lower)'));
        else console.log('     no face matched — either nobody enrolled is in frame, or the face is too small/angled at this placement');
      })"
}

if [ "$CH" = "all" ]; then
  for c in $(seq 1 10); do snap "$c"; done
else
  snap "$CH" && [ -n "$IDENT" ] && identify "$CH"
fi
