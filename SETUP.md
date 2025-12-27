# StandByMe Home Automation Setup Guide

## 📍 Your Raspberry Pi Details
- **IP Address:** `192.168.1.43`
- **Home Assistant URL:** http://192.168.1.43:8123

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Get Your Long-Lived Access Token

1. Open Home Assistant in your browser: http://192.168.1.43:8123
2. Click your **username** at the bottom of the sidebar
3. Scroll down to **"Long-Lived Access Tokens"**
4. Click **"Create Token"**
5. Name it: `StandByMe`
6. **Copy the token** (you won't see it again!)

### Step 2: Update the Configuration

Edit `index.html` and replace this line:

```javascript
const TOKEN = "YOUR_LONG_LIVED_ACCESS_TOKEN";
```

With your actual token:

```javascript
const TOKEN = "eyJ0eXAiOiJKV1QiLC...your-long-token-here...";
```

Also update these entity IDs to match your Home Assistant entities:

```javascript
const SONOS_ENTITY = "media_player.sonos";     // Your Sonos entity
const WEATHER_ENTITY = "weather.home";          // Your weather entity
```

### Step 3: Deploy to Raspberry Pi

**Option A: Using Terminal (Recommended)**

```bash
# Navigate to this folder
cd /Users/santiarano/Desktop/CODING\ PROJECTS/standbyme

# Copy file to Pi (you'll be prompted for password)
scp index.html pi@192.168.1.43:/tmp/

# SSH into Pi and move the file
ssh pi@192.168.1.43
sudo mkdir -p /usr/share/hassio/homeassistant/www
sudo cp /tmp/index.html /usr/share/hassio/homeassistant/www/
exit
```

**Option B: Using File Editor Add-on in Home Assistant**

1. Install the "File Editor" add-on from HA Add-on Store
2. Navigate to `/config/www/` (create if doesn't exist)
3. Create new file `index.html`
4. Paste the contents of your local `index.html`
5. Save

**Option C: Using Samba Share**

1. Install the "Samba Share" add-on from HA Add-on Store
2. Configure and start it
3. Connect to `\\192.168.1.43\config` from your Mac (Finder → Go → Connect to Server)
4. Create `www` folder if it doesn't exist
5. Copy `index.html` into the `www` folder

---

## 🌐 Access Your Dashboard

Once deployed, access your dashboard at:

**http://192.168.1.43:8123/local/index.html**

Load this URL in the StandByMe's built-in browser!

---

## 🔧 Customization

### Adding a Background Image

1. Find a beautiful fireplace or ambient image
2. Upload it to the same `www` folder as `fireplace.jpg`
3. Or update the URL in `index.html`:

```css
background: url('fireplace.jpg') no-repeat center center;
```

### Changing Button Actions

Update the `triggerHA()` calls in the HTML:

```html
<div class="btn" onclick="triggerHA('script', 'your_script_name')">
```

Available domains:
- `script` - for scripts
- `automation` - for automations
- `scene` - for scenes

---

## 🔍 Finding Your Entity IDs

1. Go to Home Assistant → Settings → Devices & Services
2. Click the integration (e.g., Sonos, Weather)
3. Click on the device/entity
4. The entity ID is shown at the top (e.g., `media_player.living_room_sonos`)

### Common Entity Patterns:
- Sonos: `media_player.sonos_living_room`
- Weather: `weather.home` or `weather.forecast_home`
- Scripts: `script.movie_time`
- Automations: `automation.awning_control`

---

## 🐛 Troubleshooting

### "Failed to fetch" errors in console
- Check that the IP address is correct
- Verify your access token is valid
- Ensure Home Assistant is running

### Weather not updating
- Check the `WEATHER_ENTITY` matches your actual entity ID
- Some weather integrations use `weather.forecast_home`

### Sonos controls not working
- Verify `SONOS_ENTITY` matches your Sonos speaker entity
- Test the entity in Home Assistant Developer Tools first

### CORS errors
- Add this to your `configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - http://192.168.1.43:8123
```

---

## 📱 StandByMe Browser Setup

1. On your LG StandByMe, open the built-in web browser
2. Navigate to: `http://192.168.1.43:8123/local/index.html`
3. Bookmark this page for easy access
4. Optional: Set as homepage in browser settings

---

## Need Help?

- Home Assistant API Docs: https://developers.home-assistant.io/docs/api/rest
- Community Forum: https://community.home-assistant.io

