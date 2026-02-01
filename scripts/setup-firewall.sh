#!/bin/bash

# ============================================
# UFW Firewall Setup untuk Asterisk + PJSIP
# ============================================

echo "🔥 Setting up UFW Firewall for Asterisk with PJSIP..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Error: Please run as root (sudo)${NC}"
  exit 1
fi

# Backup current UFW rules
echo -e "${YELLOW}[1/5]${NC} Backing up current UFW rules..."
ufw status numbered > /root/ufw_backup_$(date +%Y%m%d_%H%M%S).txt
echo -e "${GREEN}✓${NC} Backup created"

# Ask for development machine IP
echo ""
echo -e "${YELLOW}[2/5]${NC} Enter your development machine IP (Mac):"
echo -e "   (Leave empty to allow from anywhere - NOT RECOMMENDED for production)"
read -p "   IP Address: " DEV_IP

# Port 8088 - ARI (REQUIRED for Node.js)
echo ""
echo -e "${YELLOW}[3/5]${NC} Adding ARI port (8088)..."
if [ -z "$DEV_IP" ]; then
  ufw allow 8088/tcp comment 'Asterisk ARI'
  echo -e "${RED}⚠${NC}  Port 8088 open to all (use only for testing!)"
else
  ufw allow from $DEV_IP to any port 8088 proto tcp comment 'Asterisk ARI from Dev'
  echo -e "${GREEN}✓${NC} Port 8088 allowed from $DEV_IP only"
fi

# Port 5060 - PJSIP SIP
echo ""
echo -e "${YELLOW}[4/5]${NC} Adding PJSIP SIP ports (5060)..."
ufw allow 5060/udp comment 'PJSIP SIP UDP'
ufw allow 5060/tcp comment 'PJSIP SIP TCP'
echo -e "${GREEN}✓${NC} PJSIP SIP ports added"

# Port 10000-20000 - RTP Media
echo ""
echo -e "${YELLOW}[5/5]${NC} Adding RTP media ports (10000-20000)..."
ufw allow 10000:20000/udp comment 'RTP Media/Audio'
echo -e "${GREEN}✓${NC} RTP ports added"

# Optional: SSH (if not already allowed)
echo ""
read -p "Do you want to ensure SSH (22) is allowed? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  ufw allow 22/tcp comment 'SSH'
  echo -e "${GREEN}✓${NC} SSH port added"
fi

# Enable UFW if not already enabled
echo ""
read -p "Enable UFW firewall now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  ufw --force enable
  echo -e "${GREEN}✓${NC} UFW enabled"
fi

# Show status
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}Firewall setup complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "Current UFW rules:"
ufw status numbered

echo ""
echo -e "${YELLOW}Summary of opened ports:${NC}"
echo "  • 8088/tcp  - Asterisk ARI (for Node.js app)"
echo "  • 5060/udp  - PJSIP SIP signaling"
echo "  • 5060/tcp  - PJSIP SIP signaling (TCP)"
echo "  • 10000-20000/udp - RTP media/audio"

echo ""
echo -e "${YELLOW}Test from your Mac:${NC}"
if [ -z "$DEV_IP" ]; then
  echo "  telnet YOUR_UBUNTU_IP 8088"
else
  echo "  telnet $(hostname -I | awk '{print $1}') 8088"
fi

echo ""
echo -e "${RED}Security Note:${NC}"
echo "  For production, restrict port 8088 to specific IPs only!"
echo ""
