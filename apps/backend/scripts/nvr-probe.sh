#!/usr/bin/env bash
# Read-only interrogation of a Hikvision NVR over ISAPI.
#
#   bash scripts/nvr-probe.sh 192.168.18.16 admin 'THEPASSWORD'
#
# Answers, without changing a thing:
#   - exact model + firmware (settles whether this box has an AI engine)
#   - whether it can push HTTP at all (httpHosts capabilities)
#   - what alarm hosts are already configured (never blind-PUT over them)
#   - which channels exist and what events they support
#
# Uses curl.exe deliberately: in PowerShell `curl` is an alias for
# Invoke-WebRequest, which cannot do HTTP digest auth and will just fail.

set -uo pipefail

HOST="${1:?usage: nvr-probe.sh <ip> <user> <password>}"
USER="${2:?}"
PASS="${3:?}"

CURL=curl.exe
command -v "$CURL" >/dev/null 2>&1 || CURL=curl

get() {
  # --digest first; Hikvision uses digest, but some builds accept basic only.
  "$CURL" -sS --max-time 15 --digest -u "$USER:$PASS" "http://$HOST$1" 2>&1
}

section() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

section "device info  (model + firmware)"
info=$(get /ISAPI/System/deviceInfo)
if grep -qi 'notAuthorized\|401\|Unauthorized' <<<"$info"; then
  echo "  AUTH FAILED. Stop and re-check the password."
  echo "  Do NOT retry in a loop — Hikvision locks the admin account after a few tries."
  exit 1
fi
grep -oE '<(model|firmwareVersion|firmwareReleasedDate|deviceName|deviceType)>[^<]*' <<<"$info" \
  | sed 's/</  /; s/>/: /' || echo "$info" | head -20

section "HTTP push supported?  (httpHosts capabilities)"
caps=$(get /ISAPI/Event/notification/httpHosts/capabilities)
if grep -qi 'HttpHostNotificationCap' <<<"$caps"; then
  echo "  SUPPORTED — this NVR can push HTTP events."
  grep -oE '(hostNumber|urlLen|max)="[^"]*"' <<<"$caps" | head -10 | sed 's/^/  /'
  grep -oE '<(uploadImagesDataType|protocolType|parameterFormatType)>[^<]*' <<<"$caps" \
    | sed 's/</  /; s/>/: /' | head
else
  echo "  NOT SUPPORTED (or endpoint absent). Raw reply:"
  echo "$caps" | head -8 | sed 's/^/  /'
  echo "  -> Fall back to per-camera config, or pull RTSP directly (Route B)."
fi

section "alarm hosts already configured"
hosts=$(get /ISAPI/Event/notification/httpHosts)
echo "$hosts" | head -40 | sed 's/^/  /'

section "channels present"
get /ISAPI/ContentMgmt/InputProxy/channels \
  | grep -oE '<(id|name|ipAddress)>[^<]*' | sed 's/</  /; s/>/: /' | head -60

section "face capture supported by the NVR itself?"
for ep in \
  /ISAPI/Intelligent/channels \
  /ISAPI/Intelligent/FDLib/capabilities \
  /ISAPI/Smart/capabilities ; do
  r=$(get "$ep")
  if grep -qi '<?xml' <<<"$r" && ! grep -qi 'notSupport\|<statusCode>4' <<<"$r"; then
    echo "  $ep -> present"
  else
    echo "  $ep -> no"
  fi
done

printf '\n  Done. Nothing was modified.\n\n'
