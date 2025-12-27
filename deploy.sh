#!/bin/bash

# ============================================
# StandByMe Deployment Script
# ============================================

PI_IP="192.168.1.43"
PI_USER="pi"  # Change if your username is different

echo "🏠 StandByMe Home Automation Deployment"
echo "========================================"
echo ""
echo "This will deploy your frontend to the Raspberry Pi at $PI_IP"
echo ""

# Check if files exist
if [ ! -f "index.html" ]; then
    echo "❌ Error: index.html not found in current directory"
    exit 1
fi

# Create the www folder on the Pi (if using HA Container/Supervised)
echo "📁 Creating www folder on Home Assistant..."
ssh ${PI_USER}@${PI_IP} 'mkdir -p /home/homeassistant/.homeassistant/www 2>/dev/null || mkdir -p ~/config/www 2>/dev/null || sudo mkdir -p /usr/share/hassio/homeassistant/www 2>/dev/null'

# Try different possible paths for Home Assistant config
echo "📤 Uploading files..."

# Try common Home Assistant paths
scp index.html ${PI_USER}@${PI_IP}:/home/homeassistant/.homeassistant/www/ 2>/dev/null && echo "✅ Deployed to /home/homeassistant/.homeassistant/www/" && exit 0

scp index.html ${PI_USER}@${PI_IP}:~/config/www/ 2>/dev/null && echo "✅ Deployed to ~/config/www/" && exit 0

scp index.html ${PI_USER}@${PI_IP}:/usr/share/hassio/homeassistant/www/ 2>/dev/null && echo "✅ Deployed to /usr/share/hassio/homeassistant/www/" && exit 0

# If none worked, upload to home directory
scp index.html ${PI_USER}@${PI_IP}:~/ && echo "📁 Uploaded to home directory. You may need to move it manually to /config/www/"

echo ""
echo "🌐 Access your dashboard at: http://${PI_IP}:8123/local/index.html"
echo ""

