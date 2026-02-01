#!/bin/bash

# Test Asterisk connectivity from Mac

SERVER_IP="192.168.50.2"
ARI_USER="jarjit"
# ARI_PASS will be read from .env

echo "🔍 Testing Asterisk Server Connectivity"
echo "========================================"
echo ""

# Load .env to get password
if [ -f .env ]; then
    export $(cat .env | grep ASTERISK_PASSWORD | xargs)
fi

# Test 1: Ping
echo "[1/5] Testing network connectivity..."
if ping -c 2 $SERVER_IP > /dev/null 2>&1; then
    echo "✅ Server is reachable"
else
    echo "❌ Cannot ping server"
    exit 1
fi

# Test 2: Port 8088
echo ""
echo "[2/5] Testing ARI port 8088..."
if nc -z -w 5 $SERVER_IP 8088 2>/dev/null; then
    echo "✅ Port 8088 is open"
else
    echo "❌ Port 8088 is closed or filtered"
    echo "   Fix: sudo ufw allow 8088/tcp (on Ubuntu server)"
    exit 1
fi

# Test 3: ARI endpoint
echo ""
echo "[3/5] Testing ARI endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -u $ARI_USER:$ASTERISK_PASSWORD \
    http://$SERVER_IP:8088/ari/asterisk/info)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ ARI authentication successful"
elif [ "$HTTP_CODE" = "401" ]; then
    echo "❌ ARI authentication failed (wrong password?)"
    exit 1
else
    echo "❌ Unexpected response code: $HTTP_CODE"
    exit 1
fi

# Test 4: Port 5060 (PJSIP)
echo ""
echo "[4/5] Testing PJSIP port 5060..."
if nc -zu -w 2 $SERVER_IP 5060 2>/dev/null; then
    echo "✅ Port 5060 (PJSIP) is open"
else
    echo "⚠️  Port 5060 might be closed (needed for SIP extension registration)"
fi

# Test 5: ElevenLabs API (from .env)
echo ""
echo "[5/5] Testing ElevenLabs API..."
if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "⚠️  ELEVENLABS_API_KEY not set in .env"
else
    ELEVENLABS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "xi-api-key: $ELEVENLABS_API_KEY" \
        https://api.elevenlabs.io/v1/user)
    
    if [ "$ELEVENLABS_STATUS" = "200" ]; then
        echo "✅ ElevenLabs API key valid"
    else
        echo "❌ ElevenLabs API key invalid (status: $ELEVENLABS_STATUS)"
    fi
fi

# Summary
echo ""
echo "========================================"
echo "✅ All critical tests passed!"
echo "========================================"
echo ""
echo "You can now start the application:"
echo "  npm run dev"
echo ""
