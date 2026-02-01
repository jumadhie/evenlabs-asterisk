# Contoh Konfigurasi Asterisk

File-file konfigurasi untuk Asterisk server Ubuntu.

## 📁 /etc/asterisk/ari.conf

```ini
[general]
enabled = yes
pretty = yes
; Untuk production, specify allowed origins yang spesifik
allowed_origins = *

; Username untuk ARI access
; Nama [ari_user] bisa disesuaikan, pastikan sama dengan .env
[ari_user]
type = user
read_only = no
; Password harus sama dengan ASTERISK_PASSWORD di .env
password = AriSecurePassword123
```

## 📁 /etc/asterisk/http.conf

```ini
[general]
enabled = yes
; Listen on all network interfaces
bindaddr = 0.0.0.0
; Default ARI port
bindport = 8088

; Optional: Enable TLS untuk security
;tlsenable = yes
;tlsbindaddr = 0.0.0.0:8089
;tlscertfile = /etc/asterisk/keys/asterisk.crt
;tlsprivatekey = /etc/asterisk/keys/asterisk.key
```

## 📁 /etc/asterisk/extensions.conf

```ini
; ============================================
; Context untuk incoming calls
; ============================================

[from-trunk]
; Test extension - dial 123 untuk test
exten => 123,1,NoOp(Testing ElevenLabs Voice Agent)
  same => n,Answer()
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; Route semua incoming calls ke voice agent
exten => _X.,1,NoOp(Incoming Call from ${CALLERID(num)})
  same => n,Set(CALLERID(name)=Voice Agent)
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; ============================================
; Context untuk outgoing (jika diperlukan)
; ============================================

[from-internal]
exten => _9XXX,1,NoOp(Outbound Call)
  same => n,Dial(SIP/${EXTEN:1}@trunk)
  same => n,Hangup()

; Test voice agent dari internal
exten => *123,1,NoOp(Test Voice Agent)
  same => n,Answer()
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()
```

## 📁 /etc/asterisk/pjsip.conf (PJSIP Configuration)

Konfigurasi PJSIP trunk dan endpoint:

```ini
; ============================================
; TRANSPORT
; ============================================
[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060
external_media_address = YOUR_PUBLIC_IP
external_signaling_address = YOUR_PUBLIC_IP

[transport-tcp]
type = transport
protocol = tcp
bind = 0.0.0.0:5060

; ============================================
; TRUNK EXAMPLE (SIP Provider)
; ============================================
[trunk-provider]
type = endpoint
context = from-trunk
disallow = all
allow = ulaw
allow = alaw
allow = g729
direct_media = no
from_domain = your.sip.provider.com
outbound_auth = trunk-provider-auth
aors = trunk-provider-aor

[trunk-provider-auth]
type = auth
auth_type = userpass
username = your_username
password = your_password

[trunk-provider-aor]
type = aor
contact = sip:your.sip.provider.com

[trunk-provider-identify]
type = identify
endpoint = trunk-provider
match = YOUR_PROVIDER_IP

; ============================================
; REGISTRATION (jika diperlukan oleh provider)
; ============================================
[trunk-provider-reg]
type = registration
outbound_auth = trunk-provider-auth
server_uri = sip:your.sip.provider.com
client_uri = sip:your_username@your.sip.provider.com
retry_interval = 60
```

### Atau gunakan PJSIP Wizard (lebih mudah):

Edit `/etc/asterisk/pjsip_wizard.conf`:

```ini
; ============================================
; TRUNK dengan PJSIP Wizard
; ============================================
[trunk-provider]
type = wizard
sends_auth = yes
sends_registrations = yes
remote_hosts = your.sip.provider.com
outbound_auth/username = your_username
outbound_auth/password = your_password
endpoint/context = from-trunk
endpoint/disallow = all
endpoint/allow = ulaw,alaw
endpoint/direct_media = no
aor/qualify_frequency = 60
```

## 🔄 Reload Commands

Setelah edit konfigurasi, reload Asterisk:

```bash
# Masuk ke Asterisk CLI
sudo asterisk -rvvv

# Di dalam CLI:
ari reload
module reload res_ari
module reload res_http
dialplan reload
sip reload

# Atau dari command line langsung:
sudo asterisk -rx "ari reload"
sudo asterisk -rx "module reload res_ari"
sudo asterisk -rx "module reload res_http"
sudo asterisk -rx "dialplan reload"
```

## ✅ Verifikasi

```bash
# Check ARI status
sudo asterisk -rx "ari show status"
sudo asterisk -rx "ari show users"

# Check HTTP status
sudo asterisk -rx "http show status"

# Check dialplan
sudo asterisk -rx "dialplan show from-trunk"

# Check listening ports
sudo netstat -tulpn | grep asterisk
```

Expected output:
```
tcp        0      0 0.0.0.0:8088            0.0.0.0:*               LISTEN      1234/asterisk
```

## 🔒 Security Tips

### 1. Firewall Configuration

```bash
# Hanya izinkan IP tertentu akses ARI port
sudo ufw allow from YOUR_DEV_MACHINE_IP to any port 8088
sudo ufw deny 8088

# Atau dengan iptables
sudo iptables -A INPUT -p tcp -s YOUR_DEV_MACHINE_IP --dport 8088 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8088 -j DROP
```

### 2. Strong Password

Gunakan password yang kuat untuk ARI user:

```bash
# Generate random password
openssl rand -base64 24
```

Update di `ari.conf`:
```ini
[ari_user]
password = GeneratedStrongPassword123!@#
```

### 3. Restrict Origins

Di production, jangan gunakan `allowed_origins = *`.

Edit `ari.conf`:
```ini
[general]
allowed_origins = http://your-app-server-ip:3000
```

## 📝 File Permissions

Pastikan permissions correct:

```bash
# Set ownership
sudo chown asterisk:asterisk /etc/asterisk/*.conf

# Set permissions (readable but not writable by group/others)
sudo chmod 640 /etc/asterisk/ari.conf
sudo chmod 640 /etc/asterisk/http.conf
sudo chmod 644 /etc/asterisk/extensions.conf
```

## 🐛 Troubleshooting

### ARI tidak enable

```bash
# Check module loaded
sudo asterisk -rx "module show like res_ari"

# Load module manually
sudo asterisk -rx "module load res_ari.so"
```

### HTTP server tidak jalan

```bash
# Check module
sudo asterisk -rx "module show like res_http"

# Load manually
sudo asterisk -rx "module load res_http_websocket.so"
```

### Port 8088 tidak listening

```bash
# Restart Asterisk
sudo systemctl restart asterisk

# Check status
sudo systemctl status asterisk
```
