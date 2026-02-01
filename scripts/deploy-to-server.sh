#!/bin/bash

# Deploy script to update code on server

SERVER="root@192.168.50.2"
SERVER_PATH="/home/kibo/aplikasi/evenslabs"
LOCAL_PATH="/Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent"

echo "🚀 Deploying updated code to server..."

# Create tar with only necessary files
cd "$LOCAL_PATH"
tar -czf /tmp/elevenlabs-update.tar.gz \
  src/ \
  package.json \
  --exclude='node_modules' \
  --exclude='logs' \
  --exclude='.git'

echo "📦 Uploading to server..."
scp /tmp/elevenlabs-update.tar.gz $SERVER:$SERVER_PATH/

echo "📂 Extracting on server..."
ssh $SERVER << 'EOF'
cd /home/kibo/aplikasi/evenslabs
tar -xzf elevenlabs-update.tar.gz
rm elevenlabs-update.tar.gz
echo "✅ Code updated on server!"
EOF

rm /tmp/elevenlabs-update.tar.gz

echo "✅ Deployment complete!"
echo ""
echo "Now SSH to server and restart app:"
echo "  ssh root@192.168.50.2"
echo "  cd /home/kibo/aplikasi/evenslabs"
echo "  npm start"
