# TURN reliability for WhatsApp calling — TLS‑on‑443 setup

**Symptom this fixes:** a rep clicks **Answer** on an inbound WhatsApp call and it
sits on **"Connecting…"** and never connects (no audio). This happens for reps on
networks that block UDP / are behind symmetric NAT/CGNAT — they need the **TURN
relay** to carry the audio, and the relay must be reachable from their network.

## What the app already does (shipped)

The CRM now advertises the TURN server over **both UDP and TCP** automatically —
e.g. `TURN_URLS=turn:168.144.100.20:3478` is expanded to:

```
turn:168.144.100.20:3478?transport=udp
turn:168.144.100.20:3478?transport=tcp
```

TCP 3478 is already open on the box, so UDP‑blocked reps now get a TCP relay path.
This is the quick win. **The definitive fix is TLS‑TURN on port 443** below — it
looks like ordinary HTTPS and traverses virtually every corporate firewall.

## Definitive fix — coturn TLS on 443 (on the VPS `168.144.100.20`)

> Needs root on the TURN VPS. ~20 min. Raw‑IP TLS certs aren't issuable, so use a
> domain that points at the box (e.g. `turn.tashfeengroup.com → 168.144.100.20`).

1. **DNS:** add an A record `turn.tashfeengroup.com → 168.144.100.20`.

2. **TLS cert (Let's Encrypt):**
   ```bash
   sudo apt-get install -y certbot
   sudo certbot certonly --standalone -d turn.tashfeengroup.com
   # → /etc/letsencrypt/live/turn.tashfeengroup.com/{fullchain,privkey}.pem
   ```
   (If port 443 is held by a web server, stop it for the issuance or use the
   webroot/DNS challenge.)

3. **coturn config** (`/etc/turnserver.conf`) — add:
   ```
   listening-port=3478
   tls-listening-port=443
   fingerprint
   lt-cred-mech
   realm=turn.tashfeengroup.com
   # existing static credential stays as-is (user=<username>:<credential> or static-auth-secret)
   cert=/etc/letsencrypt/live/turn.tashfeengroup.com/fullchain.pem
   pkey=/etc/letsencrypt/live/turn.tashfeengroup.com/privkey.pem
   # relay port range MUST be open in the VPS firewall (see step 4)
   min-port=49152
   max-port=65535
   no-tlsv1
   no-tlsv1_1
   ```
   ```bash
   sudo systemctl restart coturn
   ```

4. **Firewall (VPS + cloud provider security group):** allow inbound
   - `443/tcp` (TLS‑TURN) and `3478/tcp` + `3478/udp` (existing)
   - `49152‑65535/udp` (the relay media port range) ← commonly the real blocker

5. **Point the CRM at TLS‑TURN** — set the Railway backend env var and redeploy:
   ```
   TURN_URLS=turns:turn.tashfeengroup.com:443?transport=tcp,turn:168.144.100.20:3478
   TURN_USERNAME=<existing>
   TURN_CREDENTIAL=<existing>
   ```
   (Keep the plain `turn:` entry too — the app auto‑adds udp+tcp for it; the
   `turns:443` entry is the firewall‑proof primary.)

## Verify the relay actually works

- **Trickle‑ICE tool:** open <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>,
  add `turns:turn.tashfeengroup.com:443?transport=tcp` + the username/credential,
  click **Gather candidates** → you must see a candidate of type **`relay`**.
  No `relay` candidate = TURN/relay still broken (creds, ports, or cert).
- **CLI:** `turnutils_uclient -t -T -u <user> -w <cred> -p 443 turn.tashfeengroup.com`
  (the `-T` forces TCP/TLS) should allocate a relay address.

Once a `relay` candidate appears from a rep's actual office network, "connecting →
never connects" is resolved for that network.
