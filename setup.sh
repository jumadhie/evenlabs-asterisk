#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=======================================================${NC}"
echo -e "${BLUE}   ElevenLabs-Asterisk Voice Agent - Quick Setup${NC}"
echo -e "${BLUE}=======================================================${NC}"
echo ""

# Check Node.js version
echo -e "${YELLOW}[1/4]${NC} Checking Node.js version..."
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Node.js installed: $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js >= 18.0"
    exit 1
fi

# Check FFmpeg
echo -e "${YELLOW}[2/4]${NC} Checking FFmpeg..."
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n 1)
    echo -e "${GREEN}✓${NC} FFmpeg installed"
else
    echo -e "${RED}✗${NC} FFmpeg not found"
    echo -e "${YELLOW}→${NC} Install with: brew install ffmpeg (macOS)"
    exit 1
fi

# Check .env file
echo -e "${YELLOW}[3/4]${NC} Checking configuration..."
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}→${NC} Creating .env from template..."
    cp .env.example .env
    echo -e "${GREEN}✓${NC} .env file created"
    echo -e "${RED}⚠${NC}  Please edit .env and add your credentials:"
    echo -e "   - ASTERISK_HOST"
    echo -e "   - ASTERISK_USERNAME"
    echo -e "   - ASTERISK_PASSWORD"
    echo -e "   - ELEVENLABS_API_KEY"
    echo ""
    read -p "Press Enter after you've edited .env file..."
else
    echo -e "${GREEN}✓${NC} .env file exists"
fi

# Check if dependencies installed
echo -e "${YELLOW}[4/4]${NC} Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}→${NC} Installing dependencies..."
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Dependencies installed"
    else
        echo -e "${RED}✗${NC} Failed to install dependencies"
        exit 1
    fi
else
    echo -e "${GREEN}✓${NC} Dependencies already installed"
fi

echo ""
echo -e "${BLUE}=======================================================${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo -e "${BLUE}=======================================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "${YELLOW}1.${NC} Test connections: ${GREEN}npm run test:connection${NC}"
echo -e "${YELLOW}2.${NC} (Optional) List voices: ${GREEN}node test/listVoices.js${NC}"
echo -e "${YELLOW}3.${NC} Start application: ${GREEN}npm run dev${NC}"
echo ""
echo -e "Documentation:"
echo -e "  • README.md - Overview and general info"
echo -e "  • SETUP-GUIDE.md - Detailed setup instructions"
echo -e "  • ASTERISK-CONFIG.md - Asterisk configuration examples"
echo ""
