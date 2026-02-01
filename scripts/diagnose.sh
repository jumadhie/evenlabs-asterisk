#!/bin/bash

# Quick diagnostic script untuk test semua komponen

echo "🔍 ElevenLabs-Asterisk Agent - Quick Diagnostics"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load .env
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Extract IP from ASTERISK_HOST
ASTERISK_IP=$(echo $ASTERISK_HOST | sed 's|http://||' | sed 's|:.*||')
ASTERISK_PORT=$(echo $ASTERISK_HOST | sed 's|.*:||')

echo "Configuration:"
echo "  Asterisk: $ASTERISK_IP:$ASTERISK_PORT"
echo "  ARI User: $ASTERISK_USERNAME"
echo "  App Name: $ASTERISK_APP_NAME"
echo ""

# Test 1: Network
echo -n "[1/6] Testing network connectivity... "
if ping -c 2 -W 2 $ASTERISK_IP > /dev/null 2>&1; then
    echo -e "${GREEN}✅ OK${NC}"
else
    echo -e "${RED}❌ FAILED${NC}"
    echo "      Fix: Check if Asterisk server is online"
    exit 1
fi

# Test 2: Port 8088
echo -n "[2/6] Testing ARI port $ASTERISK_PORT... "
if nc -z -w 3 $ASTERISK_IP $ASTERISK_PORT 2>/dev/null; then
    echo -e "${GREEN}✅ OPEN${NC}"
else
    echo -e "${RED}❌ CLOSED${NC}"
    echo "      Fix: sudo ufw allow $ASTERISK_PORT/tcp (on Ubuntu)"
    exit 1
fi

# Test 3: ARI Authentication
echo -n "[3/6] Testing ARI authentication... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "$ASTERISK_USERNAME:$ASTERISK_PASSWORD" \
    "$ASTERISK_HOST/ari/asterisk/info" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ OK${NC}"
elif [ "$HTTP_CODE" = "401" ]; then
    echo -e "${RED}❌ AUTH FAILED${NC}"
    echo "      Fix: Check ASTERISK_USERNAME and ASTERISK_PASSWORD in .env"
    exit 1
elif [ -z "$HTTP_CODE" ]; then
    echo -e "${RED}❌ NO RESPONSE${NC}"
    echo "      Fix: Check if Asterisk ARI is enabled"
    exit 1
else
    echo -e "${RED}❌ HTTP $HTTP_CODE${NC}"
    exit 1
fi

# Test 4: FFmpeg
echo -n "[4/6] Checking FFmpeg... "
if command -v ffmpeg > /dev/null 2>&1; then
    echo -e "${GREEN}✅ INSTALLED${NC}"
else
    echo -e "${RED}❌ NOT FOUND${NC}"
    echo "      Fix: brew install ffmpeg"
    exit 1
fi

# Test 5: ElevenLabs API
echo -n "[5/6] Testing ElevenLabs API... "
if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  NOT CONFIGURED${NC}"
    echo "      Warning: Set ELEVENLABS_API_KEY in .env"
else
    ELEVENLABS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "xi-api-key: $ELEVENLABS_API_KEY" \
        https://api.elevenlabs.io/v1/user 2>/dev/null)
    
    if [ "$ELEVENLABS_STATUS" = "200" ]; then
        echo -e "${GREEN}✅ VALID${NC}"
    elif [ "$ELEVENLABS_STATUS" = "401" ]; then
        echo -e "${RED}❌ INVALID KEY${NC}"
        echo "      Fix: Check ELEVENLABS_API_KEY in .env"
        exit 1
    else
        echo -e "${YELLOW}⚠️  HTTP $ELEVENLABS_STATUS${NC}"
    fi
fi

# Test 6: Dependencies
echo -n "[6/6] Checking Node.js dependencies... "
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ INSTALLED${NC}"
else
    echo -e "${RED}❌ NOT FOUND${NC}"
    echo "      Fix: npm install"
    exit 1
fi

# Summary
echo ""
echo "=================================================="
echo -e "${GREEN}✅ All checks passed!${NC}"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. Setup extension di Asterisk (see TEST-GUIDE.md)"
echo "  2. Register softphone"
echo "  3. Start app: ${GREEN}npm run dev${NC}"
echo "  4. Dial *123 dari softphone"
echo ""
