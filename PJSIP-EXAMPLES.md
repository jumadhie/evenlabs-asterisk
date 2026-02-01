# PJSIP Configuration Guide

Panduan lengkap konfigurasi PJSIP untuk Asterisk dengan ElevenLabs Voice Agent.

## 📋 Port yang Diperlukan

```bash
# Di Ubuntu server
sudo ufw allow 8088/tcp          # ARI (WAJIB untuk Node.js)
sudo ufw allow 5060/udp          # PJSIP SIP signaling
sudo ufw allow 5060/tcp          # PJSIP SIP signaling (TCP)
sudo ufw allow 10000:20000/udp   # RTP media/audio
```

## 📁 Konfigurasi File PJSIP

### 1. `/etc/asterisk/pjsip.conf`

```ini
; ============================================
; GLOBAL SETTINGS
; ============================================
[global]
max_forwards = 70
user_agent = Asterisk PBX
default_outbound_endpoint = default-endpoint

; ============================================
; TRANSPORT UDP
; ============================================
[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060
; Jika server behind NAT, uncomment dan isi:
;external_media_address = YOUR_PUBLIC_IP
;external_signaling_address = YOUR_PUBLIC_IP
;local_net = 192.168.0.0/16

; ============================================
; TRANSPORT TCP
; ============================================
[transport-tcp]
type = transport
protocol = tcp
bind = 0.0.0.0:5060

; ============================================
; ACL (Access Control)
; ============================================
[acl]
type = acl
deny = 0.0.0.0/0.0.0.0
permit = 192.168.0.0/16     ; Local network
permit = YOUR_PROVIDER_IP    ; SIP provider IP

; ============================================
; TRUNK CONFIGURATION - Method 1: Full Config
; ============================================

; Endpoint
[trunk-mytrunk]
type = endpoint
context = from-trunk
disallow = all
allow = ulaw
allow = alaw
allow = g729
direct_media = no
trust_id_inbound = yes
send_rpid = yes
outbound_auth = trunk-mytrunk-auth
aors = trunk-mytrunk-aor

; Authentication
[trunk-mytrunk-auth]
type = auth
auth_type = userpass
username = your_sip_username
password = your_sip_password

; Address of Record
[trunk-mytrunk-aor]
type = aor
contact = sip:your.provider.com
qualify_frequency = 60

; Identify (untuk incoming dari provider)
[trunk-mytrunk-identify]
type = identify
endpoint = trunk-mytrunk
match = YOUR_PROVIDER_IP

; Registration (jika diperlukan)
[trunk-mytrunk-reg]
type = registration
outbound_auth = trunk-mytrunk-auth
server_uri = sip:your.provider.com
client_uri = sip:your_username@your.provider.com
contact_user = your_username
retry_interval = 60
forbidden_retry_interval = 600
expiration = 3600

; ============================================
; INTERNAL EXTENSION (Optional untuk testing)
; ============================================
[100]
type = endpoint
context = from-internal
disallow = all
allow = ulaw
allow = alaw
auth = 100-auth
aors = 100

[100-auth]
type = auth
auth_type = userpass
password = extension100pass
username = 100

[100]
type = aor
max_contacts = 1
```

### 2. `/etc/asterisk/pjsip_wizard.conf` (Alternative - Easier)

```ini
; ============================================
; PJSIP WIZARD - Simplified Configuration
; ============================================

; Trunk dengan wizard (lebih mudah)
[trunk-provider]
type = wizard

; Registration
sends_registrations = yes
; Authentication
sends_auth = yes
; Server details
remote_hosts = your.sip.provider.com

; Credentials
outbound_auth/username = your_username
outbound_auth/password = your_password

; Endpoint settings
endpoint/context = from-trunk
endpoint/disallow = all
endpoint/allow = ulaw,alaw
endpoint/direct_media = no
endpoint/from_domain = your.sip.provider.com

; AOR settings
aor/qualify_frequency = 60
aor/qualify_timeout = 3.0

; ============================================
; Internal Extension dengan Wizard
; ============================================
[100]
type = wizard
accepts_registrations = yes
accepts_auth = yes
sends_auth = yes
has_hint = yes

; Authentication
inbound_auth/username = 100
inbound_auth/password = secure_password_100

; Endpoint
endpoint/context = from-internal
endpoint/disallow = all
endpoint/allow = ulaw,alaw
endpoint/direct_media = no

; AOR
aor/max_contacts = 1
aor/qualify_frequency = 30
```

## 📞 Dialplan untuk PJSIP

`/etc/asterisk/extensions.conf`:

```ini
; ============================================
; Incoming dari Trunk → Voice Agent
; ============================================
[from-trunk]
; Semua incoming call ke voice agent
exten => _X.,1,NoOp(Incoming from ${CALLERID(num)})
  same => n,Set(CALLERID(name)=ElevenLabs Agent)
  same => n,Answer()
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; Specific DID
exten => 628123456789,1,NoOp(Call to specific DID)
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; ============================================
; Internal Extensions (untuk testing)
; ============================================
[from-internal]
; Test voice agent
exten => *123,1,NoOp(Test Voice Agent)
  same => n,Answer()
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; Call ke extension 100
exten => 100,1,Dial(PJSIP/100,30)
  same => n,Voicemail(100@default,u)
  same => n,Hangup()

; Dial out dengan prefix 9
exten => _9XXXXXXXXXX,1,NoOp(Outbound to ${EXTEN:1})
  same => n,Dial(PJSIP/${EXTEN:1}@trunk-provider)
  same => n,Hangup()
```

## 🔄 Reload & Restart Commands

```bash
# Reload PJSIP
sudo asterisk -rx "pjsip reload"
sudo asterisk -rx "module reload res_pjsip"

# Reload dialplan
sudo asterisk -rx "dialplan reload"

# Restart Asterisk (jika perlu)
sudo systemctl restart asterisk
```

## ✅ Verifikasi PJSIP

### Check Transport

```bash
sudo asterisk -rx "pjsip show transports"
```

Expected output:
```
Transport:  <TransportId>........  <Type>....  <cos>  <tos>  <BindAddress....................>
==================================================================================================
transport-udp                       udp          0      0  0.0.0.0:5060
transport-tcp                       tcp          0      0  0.0.0.0:5060
```

### Check Endpoints

```bash
sudo asterisk -rx "pjsip show endpoints"
```

### Check Registration Status

```bash
sudo asterisk -rx "pjsip show registrations"
```

Expected (jika berhasil register):
```
<Registration/ServerURI..............................>  <Auth..........>  <Status.......>
==========================================================================================
trunk-provider/sip:your.provider.com                   trunk-provi...   Registered
```

### Check AORs

```bash
sudo asterisk -rx "pjsip show aors"
```

### Real-time Logging

```bash
# Di Asterisk CLI
sudo asterisk -rvvvvv

# Enable PJSIP logger
pjsip set logger on

# Test call dan lihat output
```

## 🐛 Troubleshooting PJSIP

### Registration Failed

```bash
# Check credentials
sudo asterisk -rx "pjsip show endpoint trunk-provider"

# Check auth
sudo asterisk -rx "pjsip show auth trunk-provider-auth"

# Enable verbose logging
sudo asterisk -rx "core set verbose 5"
sudo asterisk -rx "pjsip set logger on"
```

### No Audio (One-way atau Two-way)

```bash
# Check RTP settings di /etc/asterisk/rtp.conf
sudo nano /etc/asterisk/rtp.conf
```

Pastikan:
```ini
[general]
rtpstart=10000
rtpend=20000
```

Buka port RTP:
```bash
sudo ufw allow 10000:20000/udp
```

### Backend NAT Issues

Edit `/etc/asterisk/pjsip.conf`:
```ini
[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060
external_media_address = YOUR_PUBLIC_IP
external_signaling_address = YOUR_PUBLIC_IP
local_net = 192.168.0.0/16   ; Your local network
```

## 📊 Monitoring Commands

```bash
# Active channels
sudo asterisk -rx "core show channels"

# Active calls
sudo asterisk -rx "pjsip show channels"

# Call statistics
sudo asterisk -rx "core show channel stats"

# Check specific endpoint
sudo asterisk -rx "pjsip show endpoint trunk-provider"
```

## 🔐 Security Best Practices

### 1. Strong Passwords

```bash
# Generate secure password
openssl rand -base64 24
```

### 2. IP Whitelisting

```ini
; In pjsip.conf
[trunk-provider-identify]
type = identify
endpoint = trunk-provider
match = PROVIDER_IP_1
match = PROVIDER_IP_2
```

### 3. Fail2Ban untuk PJSIP

`/etc/fail2ban/filter.d/asterisk.conf`:
```ini
[Definition]
failregex = .*Registration from '.*' failed for '<HOST>:.*' - Wrong password
            .*Call from '.*' \(<HOST>:.*\) to extension '.*' rejected because extension not found
ignoreregex =
```

`/etc/fail2ban/jail.local`:
```ini
[asterisk]
enabled = true
filter = asterisk
action = iptables-allports
logpath = /var/log/asterisk/messages
maxretry = 3
bantime = 3600
```

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Show endpoints | `pjsip show endpoints` |
| Show registrations | `pjsip show registrations` |
| Reload config | `pjsip reload` |
| Enable logging | `pjsip set logger on` |
| Show channels | `pjsip show channels` |
| Qualify endpoint | `pjsip qualify trunk-provider` |

---

**Tips:** Gunakan `pjsip_wizard.conf` untuk konfigurasi yang lebih sederhana, terutama untuk trunk!
