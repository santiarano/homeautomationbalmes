// ============================================
// StandByMe Dashboard - Main Application
// ============================================

// ============================================
// GLOBAL SETTINGS (loaded from localStorage)
// ============================================
let settings = {
    showLyrics: true,
    backgroundDarkness: 0,
    playerLayout: 'classic' // 'classic' or 'cinematic'
};
const SETTINGS_KEY = 'standbyme_settings';

// Open settings modal
function openSettings() {
    document.getElementById('settings-modal').classList.add('open');
}

// Close settings modal
function closeSettings() {
    document.getElementById('settings-modal').classList.remove('open');
    // Save settings
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.log('Could not save settings:', e);
    }
}

// Toggle lyrics setting
function toggleLyricsSetting() {
    settings.showLyrics = !settings.showLyrics;
    applySettings();
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
}

// Update darkness setting
function updateDarkness(value) {
    settings.backgroundDarkness = parseInt(value);
    document.getElementById('dark-overlay').style.opacity = value / 100;
    document.getElementById('darkness-value').textContent = `${value}%`;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
}

// Set player layout
function setLayout(layout) {
    settings.playerLayout = layout;
    applySettings();
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
}

// Apply current settings to UI
function applySettings() {
    // Lyrics toggle
    const lyricsToggle = document.getElementById('toggle-lyrics');
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsToggle && lyricsContainer) {
        if (settings.showLyrics) {
            lyricsToggle.classList.add('active');
            lyricsContainer.style.display = 'flex';
        } else {
            lyricsToggle.classList.remove('active');
            lyricsContainer.style.display = 'none';
        }
    }
    
    // Background darkness
    const overlay = document.getElementById('dark-overlay');
    const slider = document.getElementById('darkness-slider');
    const valueDisplay = document.getElementById('darkness-value');
    if (overlay) overlay.style.opacity = settings.backgroundDarkness / 100;
    if (slider) slider.value = settings.backgroundDarkness;
    if (valueDisplay) valueDisplay.textContent = `${settings.backgroundDarkness}%`;
    
    // Player layout
    const body = document.body;
    const classicOption = document.getElementById('layout-classic');
    const cinematicOption = document.getElementById('layout-cinematic');
    
    // Remove all layout classes
    body.classList.remove('layout-classic', 'layout-cinematic');
    
    // Apply selected layout
    if (settings.playerLayout === 'cinematic') {
        body.classList.add('layout-cinematic');
        if (classicOption) classicOption.classList.remove('active');
        if (cinematicOption) cinematicOption.classList.add('active');
    } else {
        body.classList.add('layout-classic');
        if (classicOption) classicOption.classList.add('active');
        if (cinematicOption) cinematicOption.classList.remove('active');
    }
}

// ============================================
// DISABLE VIRTUAL REMOTE IMMEDIATELY
// ============================================
(function() {
    if (typeof webOSSystem !== 'undefined') {
        try {
            if (webOSSystem.setInputMethod) {
                webOSSystem.setInputMethod('none');
            }
            if (webOSSystem.setProperty) {
                webOSSystem.setProperty('virtualKeyboard', false);
                webOSSystem.setProperty('virtualRemote', false);
            }
            if (webOSSystem.setCursorVisibility) {
                webOSSystem.setCursorVisibility(false);
            }
        } catch (e) {
            // Silently fail if APIs not available
        }
    }
})();

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================
const HA_IP = "192.168.1.43:8123"; 
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxYmJiMzE4Y2U1ZmM0ZTgwYTQ2YjQ2YzhjMWJiOTNlNSIsImlhdCI6MTc2Njc1ODExMCwiZXhwIjoyMDgyMTE4MTEwfQ.CgYlVdrP-CGcBRH7ChYkb82Pu-cGZyyF2B0ovj_6V74";
const SONOS_ENTITY = "media_player.sonos";
const APPLETV_ENTITY = "media_player.appletv";
const WEATHER_ENTITY = "weather.forecast_home";

// Track which media source is currently active
let activeMediaSource = SONOS_ENTITY;
let sonosState = null;
let appletvState = null;

// Playlist data
let spotifyPlaylists = [];
let playlistColors = {}; // Cache for extracted colors
let currentPlayingPlaylistId = null;

// Pastel color palette for fallback (when no art available)
const PASTEL_COLORS = [
    '#FFB5BA', '#FFDAB5', '#FFFCB5', '#BAFFC9', '#BAE1FF',
    '#E0BBE4', '#957DAD', '#D291BC', '#FEC8D8', '#FFDFD3',
    '#B5EAD7', '#C7CEEA', '#E2F0CB', '#FFDAC1', '#FF9AA2'
];

// ============================================
// HOME ASSISTANT API CALLS
// ============================================

// Trigger automations and scripts
async function triggerHA(domain, service) {
    const url = `http://${HA_IP}/api/services/${domain}/turn_on`;
    const body = JSON.stringify({ entity_id: `${domain}.${service}` });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: body
        });
        if (!response.ok) {
            console.error("Action failed:", response.status);
        }
    } catch (e) { 
        console.error("Action failed:", e); 
    }
}

// Media player commands - send to both Sonos and Apple TV
async function sonos(command) {
    const action = command === 'toggle' ? 'media_play_pause' : `media_${command}_track`;
    
    console.log(`Media command: ${command} -> ${action}, active source: ${activeMediaSource}`);
    
    try {
        const response = await fetch(`http://${HA_IP}/api/services/media_player/${action}`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ entity_id: activeMediaSource })
        });
        
        if (!response.ok) {
            console.error(`Media command failed: ${response.status}`);
        } else {
            console.log(`Media command sent successfully to ${activeMediaSource}`);
        }
        
        // Refresh UI after command
        setTimeout(updateMediaPlayer, 500);
    } catch (e) {
        console.error("Media command failed:", e);
    }
}

// Toggle shuffle mode
async function toggleShuffle() {
    try {
        await fetch(`http://${HA_IP}/api/services/media_player/shuffle_set`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: activeMediaSource,
                shuffle: !(sonosState?.attributes?.shuffle || false)
            })
        });
        
        // Refresh UI after command
        setTimeout(updateMediaPlayer, 500);
    } catch (e) {
        console.error("Shuffle toggle failed:", e);
    }
}

// ============================================
// LYRICS SYSTEM (LrcLib)
// ============================================
let currentLyricsSong = '';
let syncedLyrics = [];
let lyricsInterval = null;
let currentLineIndex = -1;

// Fetch lyrics from LrcLib API
async function fetchLyrics(songTitle, artistName) {
    if (!settings.showLyrics) return;
    
    const songKey = `${songTitle}-${artistName}`;
    if (songKey === currentLyricsSong) return;
    
    currentLyricsSong = songKey;
    syncedLyrics = [];
    currentLineIndex = -1;
    
    document.getElementById('lyrics-current').textContent = '';
    document.getElementById('lyrics-next').textContent = '';
    
    try {
        const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(songTitle)}&artist_name=${encodeURIComponent(artistName)}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log('No lyrics found for:', songTitle);
            showNoLyrics();
            return;
        }
        
        const data = await response.json();
        
        if (data.syncedLyrics) {
            syncedLyrics = parseLRC(data.syncedLyrics);
            console.log(`Loaded ${syncedLyrics.length} synced lyrics lines`);
            startLyricsDisplay();
        } else if (data.plainLyrics) {
            console.log('Only plain lyrics available (no sync)');
            showNoLyrics();
        } else {
            showNoLyrics();
        }
    } catch (e) {
        console.error('Lyrics fetch failed:', e);
        showNoLyrics();
    }
}

// Parse LRC format lyrics
function parseLRC(lrc) {
    const lines = lrc.split('\n');
    const parsed = [];
    
    for (const line of lines) {
        const match = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3]);
            const time = minutes * 60 + seconds + ms / 100;
            const text = match[4].trim();
            if (text) {
                parsed.push({ time, text });
            }
        }
    }
    
    return parsed.sort((a, b) => a.time - b.time);
}

// Get actual playback position from Home Assistant
function getPlaybackPosition() {
    const state = activeMediaSource === APPLETV_ENTITY ? appletvState : sonosState;
    if (!state || !state.attributes) return null;
    
    const position = state.attributes.media_position;
    const updatedAt = state.attributes.media_position_updated_at;
    const playerState = state.state;
    
    if (typeof position !== 'number') return null;
    
    if (playerState !== 'playing') {
        return position;
    }
    
    if (updatedAt) {
        const updateTime = new Date(updatedAt).getTime();
        const now = Date.now();
        const elapsed = (now - updateTime) / 1000;
        return position + elapsed;
    }
    
    return position;
}

// Start displaying lyrics
function startLyricsDisplay() {
    if (lyricsInterval) clearInterval(lyricsInterval);
    
    const currentEl = document.getElementById('lyrics-current');
    const nextEl = document.getElementById('lyrics-next');
    
    lyricsInterval = setInterval(() => {
        const position = getPlaybackPosition();
        if (position === null) return;
        
        let newIndex = -1;
        for (let i = 0; i < syncedLyrics.length; i++) {
            if (syncedLyrics[i].time <= position) {
                newIndex = i;
            } else {
                break;
            }
        }
        
        if (newIndex !== currentLineIndex && newIndex >= 0) {
            currentLineIndex = newIndex;
            
            currentEl.textContent = syncedLyrics[currentLineIndex].text;
            currentEl.classList.remove('hidden');
            
            if (currentLineIndex + 1 < syncedLyrics.length) {
                nextEl.textContent = syncedLyrics[currentLineIndex + 1].text;
                nextEl.classList.remove('hidden');
            } else {
                nextEl.textContent = '';
                nextEl.classList.add('hidden');
            }
        }
    }, 100);
}

// Show "no lyrics" state
function showNoLyrics() {
    document.getElementById('lyrics-current').textContent = '';
    document.getElementById('lyrics-next').textContent = '';
}

// Stop lyrics display
function stopLyrics() {
    if (lyricsInterval) {
        clearInterval(lyricsInterval);
        lyricsInterval = null;
    }
    currentLineIndex = -1;
    currentLyricsSong = '';
    document.getElementById('lyrics-current').textContent = '';
    document.getElementById('lyrics-next').textContent = '';
}

// ============================================
// WEATHER UPDATES
// ============================================

function titleCaseCondition(raw) {
    if (!raw) return '—';
    const s = String(raw).replace(/_/g, ' ').trim();
    const map = {
        partlycloudy: 'Partly Cloudy',
        partly_cloudy: 'Partly Cloudy',
        mostlysunny: 'Mostly Sunny',
        mostly_sunny: 'Mostly Sunny',
        clear: 'Clear',
        sunny: 'Sunny',
        cloudy: 'Cloudy',
        rainy: 'Rainy',
        pouring: 'Pouring',
        snowy: 'Snowy',
        fog: 'Fog',
        windy: 'Windy',
    };
    const key = s.toLowerCase().replace(/\s+/g, '_');
    if (map[key]) return map[key];
    return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

// ============================================
// WEATHER ICON GENERATOR
// ============================================

function getWeatherIcon(condition) {
    const cond = condition.toLowerCase();
    const icons = {
        'clear': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="30"/><line x1="100" y1="20" x2="100" y2="5" stroke-width="8"/><line x1="100" y1="180" x2="100" y2="195" stroke-width="8"/><line x1="20" y1="100" x2="5" y2="100" stroke-width="8"/><line x1="180" y1="100" x2="195" y2="100" stroke-width="8"/><line x1="40" y1="40" x2="28" y2="28" stroke-width="8"/><line x1="160" y1="160" x2="172" y2="172" stroke-width="8"/><line x1="40" y1="160" x2="28" y2="172" stroke-width="8"/><line x1="160" y1="40" x2="172" y2="28" stroke-width="8"/></svg>',
        'sunny': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="30"/><line x1="100" y1="20" x2="100" y2="5" stroke-width="8"/><line x1="100" y1="180" x2="100" y2="195" stroke-width="8"/><line x1="20" y1="100" x2="5" y2="100" stroke-width="8"/><line x1="180" y1="100" x2="195" y2="100" stroke-width="8"/><line x1="40" y1="40" x2="28" y2="28" stroke-width="8"/><line x1="160" y1="160" x2="172" y2="172" stroke-width="8"/><line x1="40" y1="160" x2="28" y2="172" stroke-width="8"/><line x1="160" y1="40" x2="172" y2="28" stroke-width="8"/></svg>',
        'clear-day': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="30"/><line x1="100" y1="20" x2="100" y2="5" stroke-width="8"/><line x1="100" y1="180" x2="100" y2="195" stroke-width="8"/><line x1="20" y1="100" x2="5" y2="100" stroke-width="8"/><line x1="180" y1="100" x2="195" y2="100" stroke-width="8"/><line x1="40" y1="40" x2="28" y2="28" stroke-width="8"/><line x1="160" y1="160" x2="172" y2="172" stroke-width="8"/><line x1="40" y1="160" x2="28" y2="172" stroke-width="8"/><line x1="160" y1="40" x2="172" y2="28" stroke-width="8"/></svg>',
        'partlycloudy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="80" cy="80" r="25"/><line x1="80" y1="50" x2="80" y2="40" stroke-width="6"/><line x1="80" y1="120" x2="80" y2="130" stroke-width="6"/><line x1="50" y1="80" x2="40" y2="80" stroke-width="6"/><line x1="110" y1="80" x2="120" y2="80" stroke-width="6"/><path d="M140 130H80c-15 0-28-10-28-23 0-12 9-22 21-23 5-15 20-25 36-22 8 2 16 7 21 13 16 1 29 13 29 28 0 15-12 27-27 27Z" stroke-width="8"/></svg>',
        'partly-cloudy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="80" cy="80" r="25"/><line x1="80" y1="50" x2="80" y2="40" stroke-width="6"/><line x1="80" y1="120" x2="80" y2="130" stroke-width="6"/><line x1="50" y1="80" x2="40" y2="80" stroke-width="6"/><line x1="110" y1="80" x2="120" y2="80" stroke-width="6"/><path d="M140 130H80c-15 0-28-10-28-23 0-12 9-22 21-23 5-15 20-25 36-22 8 2 16 7 21 13 16 1 29 13 29 28 0 15-12 27-27 27Z" stroke-width="8"/></svg>',
        'mostlysunny': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="80" cy="80" r="25"/><line x1="80" y1="50" x2="80" y2="40" stroke-width="6"/><line x1="80" y1="120" x2="80" y2="130" stroke-width="6"/><line x1="50" y1="80" x2="40" y2="80" stroke-width="6"/><line x1="110" y1="80" x2="120" y2="80" stroke-width="6"/><path d="M140 130H80c-15 0-28-10-28-23 0-12 9-22 21-23 5-15 20-25 36-22 8 2 16 7 21 13 16 1 29 13 29 28 0 15-12 27-27 27Z" stroke-width="8"/></svg>',
        'mostly_sunny': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="80" cy="80" r="25"/><line x1="80" y1="50" x2="80" y2="40" stroke-width="6"/><line x1="80" y1="120" x2="80" y2="130" stroke-width="6"/><line x1="50" y1="80" x2="40" y2="80" stroke-width="6"/><line x1="110" y1="80" x2="120" y2="80" stroke-width="6"/><path d="M140 130H80c-15 0-28-10-28-23 0-12 9-22 21-23 5-15 20-25 36-22 8 2 16 7 21 13 16 1 29 13 29 28 0 15-12 27-27 27Z" stroke-width="8"/></svg>',
        'cloudy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M160 140H70c-20 0-36-14-36-32 0-16 12-30 28-32 8-20 28-34 50-30 12 3 22 11 28 20 22 2 40 18 40 40 0 22-18 40-40 42Z" stroke-width="8"/></svg>',
        'cloud': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M160 140H70c-20 0-36-14-36-32 0-16 12-30 28-32 8-20 28-34 50-30 12 3 22 11 28 20 22 2 40 18 40 40 0 22-18 40-40 42Z" stroke-width="8"/></svg>',
        'rainy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><line x1="80" y1="150" x2="80" y2="175" stroke-width="6"/><line x1="100" y1="150" x2="100" y2="175" stroke-width="6"/><line x1="120" y1="150" x2="120" y2="175" stroke-width="6"/></svg>',
        'rain': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><line x1="80" y1="150" x2="80" y2="175" stroke-width="6"/><line x1="100" y1="150" x2="100" y2="175" stroke-width="6"/><line x1="120" y1="150" x2="120" y2="175" stroke-width="6"/></svg>',
        'pouring': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><line x1="75" y1="150" x2="75" y2="180" stroke-width="6"/><line x1="90" y1="150" x2="90" y2="180" stroke-width="6"/><line x1="105" y1="150" x2="105" y2="180" stroke-width="6"/><line x1="120" y1="150" x2="120" y2="180" stroke-width="6"/></svg>',
        'snowy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><circle cx="80" cy="160" r="4"/><circle cx="100" cy="160" r="4"/><circle cx="120" cy="160" r="4"/><line x1="76" y1="156" x2="84" y2="164" stroke-width="4"/><line x1="84" y1="156" x2="76" y2="164" stroke-width="4"/><line x1="96" y1="156" x2="104" y2="164" stroke-width="4"/><line x1="104" y1="156" x2="96" y2="164" stroke-width="4"/><line x1="116" y1="156" x2="124" y2="164" stroke-width="4"/><line x1="124" y1="156" x2="116" y2="164" stroke-width="4"/></svg>',
        'snow': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><circle cx="80" cy="160" r="4"/><circle cx="100" cy="160" r="4"/><circle cx="120" cy="160" r="4"/><line x1="76" y1="156" x2="84" y2="164" stroke-width="4"/><line x1="84" y1="156" x2="76" y2="164" stroke-width="4"/><line x1="96" y1="156" x2="104" y2="164" stroke-width="4"/><line x1="104" y1="156" x2="96" y2="164" stroke-width="4"/><line x1="116" y1="156" x2="124" y2="164" stroke-width="4"/><line x1="124" y1="156" x2="116" y2="164" stroke-width="4"/></svg>',
        'foggy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8" opacity="0.6"/><line x1="50" y1="150" x2="150" y2="150" stroke-width="6" opacity="0.5"/><line x1="60" y1="165" x2="140" y2="165" stroke-width="6" opacity="0.5"/></svg>',
        'fog': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8" opacity="0.6"/><line x1="50" y1="150" x2="150" y2="150" stroke-width="6" opacity="0.5"/><line x1="60" y1="165" x2="140" y2="165" stroke-width="6" opacity="0.5"/></svg>',
        'misty': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8" opacity="0.6"/><line x1="50" y1="150" x2="150" y2="150" stroke-width="6" opacity="0.5"/><line x1="60" y1="165" x2="140" y2="165" stroke-width="6" opacity="0.5"/></svg>',
        'windy': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><path d="M40 150 Q60 145 80 150 T120 150" stroke-width="6" fill="none"/><path d="M50 170 Q70 165 90 170 T130 170" stroke-width="6" fill="none"/></svg>',
        'wind': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><path d="M40 150 Q60 145 80 150 T120 150" stroke-width="6" fill="none"/><path d="M50 170 Q70 165 90 170 T130 170" stroke-width="6" fill="none"/></svg>',
        'thunderstorm': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><path d="M85 150 L95 170 L85 170 L100 190 L90 150 Z" stroke-width="6" fill="var(--gold)"/></svg>',
        'storm': '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M150 130H60c-18 0-32-12-32-28 0-14 11-26 25-28 6-18 24-30 43-26 10 2 19 8 25 16 19 1 35 15 35 34 0 18-14 32-33 32Z" stroke-width="8"/><path d="M85 150 L95 170 L85 170 L100 190 L90 150 Z" stroke-width="6" fill="var(--gold)"/></svg>',
    };
    
    if (icons[cond]) return icons[cond];
    
    if (cond.includes('rain')) return icons['rainy'];
    if (cond.includes('snow')) return icons['snowy'];
    if (cond.includes('cloud')) return icons['cloudy'];
    if (cond.includes('fog') || cond.includes('mist')) return icons['foggy'];
    if (cond.includes('wind')) return icons['windy'];
    if (cond.includes('storm') || cond.includes('thunder')) return icons['thunderstorm'];
    if (cond.includes('clear') || cond.includes('sun')) return icons['clear'];
    
    return icons['partlycloudy'];
}

async function updateWeather() {
    try {
        const response = await fetch(`http://${HA_IP}/api/states/${WEATHER_ENTITY}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (response.ok) {
            const data = await response.json();
            const temp = Math.round(data.attributes.temperature);
            const unit = data.attributes.temperature_unit || '°F';
            const condition = titleCaseCondition(data.state);
            
            document.getElementById('temperature').textContent = `${temp}${unit}`;
            document.getElementById('weather-condition').textContent = condition;
            document.getElementById('temperature').classList.remove('loading');
            
            const iconContainer = document.getElementById('weather-icon');
            if (iconContainer) {
                iconContainer.innerHTML = getWeatherIcon(data.state);
            }

            const attrs = data.attributes;
            const forecast = attrs.forecast || [];
            
            let tempHigh = null;
            let tempLow = null;
            
            if (forecast && forecast.length > 0) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                let todayForecast = forecast.find(f => {
                    if (f.datetime) {
                        try {
                            const fDate = new Date(f.datetime);
                            fDate.setHours(0, 0, 0, 0);
                            return fDate.getTime() === today.getTime();
                        } catch (e) {
                            return false;
                        }
                    }
                    return false;
                });
                
                if (!todayForecast && forecast.length > 0) {
                    todayForecast = forecast[0];
                }
                
                if (todayForecast) {
                    tempHigh = typeof todayForecast.temperature === 'number' ? Math.round(todayForecast.temperature) : null;
                    tempLow = typeof todayForecast.templow === 'number' ? Math.round(todayForecast.templow) : null;
                    
                    if (tempHigh === null && typeof todayForecast.temp === 'number') {
                        tempHigh = Math.round(todayForecast.temp);
                    }
                    if (tempLow === null && typeof todayForecast.temp_min === 'number') {
                        tempLow = Math.round(todayForecast.temp_min);
                    }
                }
                
                if (tempHigh === null || tempLow === null) {
                    const temps = forecast.slice(0, 5).map(f => {
                        const t = typeof f.temperature === 'number' ? f.temperature : (typeof f.temp === 'number' ? f.temp : null);
                        return t;
                    }).filter(t => t !== null);
                    
                    if (temps.length > 0) {
                        if (tempHigh === null) tempHigh = Math.round(Math.max(...temps));
                        if (tempLow === null) tempLow = Math.round(Math.min(...temps));
                    }
                }
            }
            
            if (tempHigh === null) {
                if (typeof attrs.temp_max === 'number') {
                    tempHigh = Math.round(attrs.temp_max);
                } else if (typeof attrs.temperature === 'number') {
                    tempHigh = Math.round(attrs.temperature);
                } else if (typeof attrs.temp === 'number') {
                    tempHigh = Math.round(attrs.temp);
                }
            }
            
            if (tempLow === null) {
                if (typeof attrs.temp_min === 'number') {
                    tempLow = Math.round(attrs.temp_min);
                } else if (typeof attrs.templow === 'number') {
                    tempLow = Math.round(attrs.templow);
                } else if (typeof attrs.temperature === 'number') {
                    const currentTemp = attrs.temperature;
                    const now = new Date();
                    const hour = now.getHours();
                    
                    let estimatedLow = currentTemp;
                    if (hour >= 6 && hour < 18) {
                        estimatedLow = currentTemp - 5;
                    } else {
                        estimatedLow = currentTemp - 2;
                    }
                    
                    tempLow = Math.round(estimatedLow);
                }
            }
            
            let feelsLike = null;
            
            if (typeof attrs.apparent_temperature === 'number') {
                feelsLike = Math.round(attrs.apparent_temperature);
            } else if (typeof attrs.feels_like === 'number') {
                feelsLike = Math.round(attrs.feels_like);
            } else if (typeof attrs.feelslike === 'number') {
                feelsLike = Math.round(attrs.feelslike);
            } else if (typeof attrs.apparent === 'number') {
                feelsLike = Math.round(attrs.apparent);
            } else {
                const currentTemp = typeof attrs.temperature === 'number' ? attrs.temperature : null;
                const humidity = typeof attrs.humidity === 'number' ? attrs.humidity : null;
                const windSpeed = typeof attrs.wind_speed === 'number' ? attrs.wind_speed : null;
                
                if (currentTemp !== null) {
                    let windMs = windSpeed;
                    if (windSpeed !== null && windSpeed > 50) {
                        windMs = windSpeed / 3.6;
                    } else if (windSpeed !== null && windSpeed < 20) {
                        windMs = windSpeed;
                    }
                    
                    if (currentTemp < 10 && windMs !== null && windMs > 0) {
                        feelsLike = 13.12 + 0.6215 * currentTemp - 11.37 * Math.pow(windMs, 0.16) + 0.3965 * currentTemp * Math.pow(windMs, 0.16);
                    } else if (currentTemp > 27 && humidity !== null) {
                        const hi = -8.78469475556 + 1.61139411 * currentTemp + 2.33854883889 * humidity - 0.14611605 * currentTemp * humidity;
                        feelsLike = hi;
                    } else {
                        let adjustment = 0;
                        if (humidity !== null) {
                            adjustment += (humidity - 50) * 0.05;
                        }
                        if (windMs !== null && windMs > 2) {
                            adjustment -= windMs * 0.3;
                        }
                        feelsLike = currentTemp + adjustment;
                    }
                    
                    if (feelsLike !== null) {
                        feelsLike = Math.round(feelsLike);
                    }
                }
            }
            
            document.getElementById('temp-high').textContent = tempHigh !== null ? `${tempHigh}${unit}` : '—';
            document.getElementById('temp-low').textContent = tempLow !== null ? `${tempLow}${unit}` : '—';
            document.getElementById('temp-feels').textContent = feelsLike !== null ? `${feelsLike}${unit}` : '—';
        }
    } catch (e) {
        console.error("Weather update failed:", e);
    }
}

// ============================================
// MEDIA PLAYER UPDATES
// ============================================
let currentArtwork = '';

async function updateMediaPlayer() {
    try {
        const [sonosRes, appletvRes] = await Promise.all([
            fetch(`http://${HA_IP}/api/states/${SONOS_ENTITY}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
            }).catch(() => null),
            fetch(`http://${HA_IP}/api/states/${APPLETV_ENTITY}`, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            }).catch(() => null)
        ]);
        
        sonosState = sonosRes && sonosRes.ok ? await sonosRes.json() : null;
        appletvState = appletvRes && appletvRes.ok ? await appletvRes.json() : null;
        
        console.log('Sonos state:', sonosState?.state, 'AppleTV state:', appletvState?.state);
        
        const activeStates = ['playing', 'paused', 'buffering'];
        
        if (appletvState && activeStates.includes(appletvState.state) && appletvState.attributes.media_title) {
            activeMediaSource = APPLETV_ENTITY;
        } else if (sonosState && activeStates.includes(sonosState.state)) {
            activeMediaSource = SONOS_ENTITY;
        } else if (sonosState) {
            activeMediaSource = SONOS_ENTITY;
        } else if (appletvState) {
            activeMediaSource = APPLETV_ENTITY;
        }
        
        const data = activeMediaSource === APPLETV_ENTITY ? appletvState : sonosState;
        
        if (data) {
            const attrs = data.attributes;
            const state = data.state;
            const friendlyName = attrs.friendly_name || activeMediaSource.replace('media_player.', '');
            
            const title = attrs.media_title || attrs.app_name || 'No Media Playing';
            const artist = attrs.media_artist || attrs.media_series_title || '';
            const album = attrs.media_album_name || '';
            const playlist = attrs.media_playlist || attrs.media_content_id || attrs.queue_name || '';
            
            document.getElementById('song').textContent = title;
            document.getElementById('album').textContent = album;
            document.getElementById('artist').textContent = artist;
            document.getElementById('playlist').textContent = playlist ? `♪ ${playlist}` : '';
            
            const shuffleBtn = document.getElementById('shuffle-btn');
            if (attrs.shuffle) {
                shuffleBtn.classList.add('active');
            } else {
                shuffleBtn.classList.remove('active');
            }
            
            if (settings.showLyrics && title && artist) {
                fetchLyrics(title, artist);
            }
            
            const artworkPath = attrs.entity_picture || attrs.media_image_url || attrs.media_image_uri;
            if (artworkPath && artworkPath !== currentArtwork) {
                currentArtwork = artworkPath;
                const miniAlbumImg = document.getElementById('mini-album-img');
                const miniPlaceholder = document.getElementById('mini-album-placeholder');
                
                let artworkUrl;
                if (artworkPath.startsWith('http')) {
                    artworkUrl = artworkPath;
                } else {
                    artworkUrl = `http://${HA_IP}${artworkPath}`;
                }
                
                if (miniAlbumImg) {
                    miniAlbumImg.onload = function() {
                        miniAlbumImg.classList.add('loaded');
                        if (miniPlaceholder) miniPlaceholder.style.display = 'none';
                    };
                    miniAlbumImg.onerror = function() {
                        miniAlbumImg.classList.remove('loaded');
                        if (miniPlaceholder) miniPlaceholder.style.display = 'flex';
                    };
                    miniAlbumImg.src = artworkUrl;
                }
            } else if (!artworkPath) {
                const miniAlbumImg = document.getElementById('mini-album-img');
                const miniPlaceholder = document.getElementById('mini-album-placeholder');
                if (miniAlbumImg) miniAlbumImg.classList.remove('loaded');
                if (miniPlaceholder) miniPlaceholder.style.display = 'flex';
                currentArtwork = '';
            }
            
            // Detect currently playing playlist
            detectCurrentPlaylist();
            
            let volumeLevel = 0;
            if (sonosState && typeof sonosState.attributes.volume_level === 'number') {
                volumeLevel = sonosState.attributes.volume_level;
            }
            
            const volumePercent = Math.round(volumeLevel * 100);
            // Update volume UI with new bar design
            updateVolumeUI(volumeLevel);
            
            const isPlaying = state === 'playing';
            const playBtn = document.getElementById('play-btn');
            if (isPlaying) {
                playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
            } else {
                playBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            }
            
            let sourceName = friendlyName;
            if (activeMediaSource === SONOS_ENTITY) {
                const groupMembers = attrs.group_members || [];
                if (groupMembers.length > 1) {
                    sourceName = groupMembers.map(m => m.replace('media_player.', '')).join(' + ');
                } else {
                    sourceName = 'Sonos';
                }
            } else if (activeMediaSource === APPLETV_ENTITY) {
                sourceName = 'Apple TV';
            }
            document.getElementById('speaker-info').textContent = sourceName;
            
            console.log(`Active source: ${activeMediaSource}, Title: ${title}, State: ${state}`);
        } else {
            document.getElementById('song').textContent = 'No Media';
            document.getElementById('album').textContent = '';
            document.getElementById('artist').textContent = '';
            document.getElementById('playlist').textContent = '';
            document.getElementById('speaker-info').textContent = 'Offline';
            document.getElementById('shuffle-btn').classList.remove('active');
            stopLyrics();
        }
    } catch (e) {
        console.error("Media player update failed:", e);
    }
}

const updateSonos = updateMediaPlayer;

// Set volume directly (from slider)
async function setVolume(percent) {
    try {
        let newVol = Math.min(100, Math.max(0, parseInt(percent))) / 100;

        console.log(`Volume set to: ${Math.round(newVol * 100)}%`);

        await fetch(`http://${HA_IP}/api/services/media_player/volume_set`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: SONOS_ENTITY,
                volume_level: newVol
            })
        });
        
        updateVolumeUI(newVol);
        
        if (sonosState && sonosState.attributes) {
            sonosState.attributes.volume_level = newVol;
        }
    } catch (e) {
        console.error("Volume set failed:", e);
    }
}

// Adjust volume (increment/decrement)
async function adjustVolume(delta) {
    try {
        let currentVol = sonosState?.attributes?.volume_level || 0;
        let newVol = Math.min(1, Math.max(0, currentVol + delta));

        console.log(`Volume: ${Math.round(currentVol * 100)}% -> ${Math.round(newVol * 100)}%`);

        await fetch(`http://${HA_IP}/api/services/media_player/volume_set`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: SONOS_ENTITY,
                volume_level: newVol
            })
        });
        
        updateVolumeUI(newVol);
        
        if (sonosState && sonosState.attributes) {
            sonosState.attributes.volume_level = newVol;
        }
    } catch (e) {
        console.error("Volume adjust failed:", e);
    }
}

// Update volume UI elements
function updateVolumeUI(volumeLevel) {
    const volumePercent = Math.round(volumeLevel * 100);
    
    // Update text display
    const volumeText = document.getElementById('volume');
    if (volumeText) {
        volumeText.textContent = volumePercent;
    }
    
    // Update fill bar
    const volumeFill = document.getElementById('volume-fill');
    if (volumeFill) {
        volumeFill.style.width = `${volumePercent}%`;
    }
    
    // Update slider input
    const volumeInput = document.getElementById('volume-input');
    if (volumeInput) {
        volumeInput.value = volumePercent;
    }
}

// ============================================
// PLAYLIST CAROUSEL SYSTEM
// ============================================

// Fetch playlists from Sonos Favorites via Home Assistant browse_media
async function fetchSpotifyPlaylists() {
    try {
        console.log('Fetching Sonos playlists...');
        
        // Step 1: Browse to favorites folder to get the Playlists subfolder
        const favResponse = await fetch(`http://${HA_IP}/api/services/media_player/browse_media?return_response`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: SONOS_ENTITY,
                media_content_type: 'favorites',
                media_content_id: ''
            })
        });
        
        if (!favResponse.ok) {
            console.log('browse_media favorites failed:', favResponse.status);
            showPlaylistEmptyState();
            return;
        }
        
        const favData = await favResponse.json();
        console.log('Favorites response:', favData);
        
        // Find the Playlists folder
        const sonosData = favData.service_response && favData.service_response[SONOS_ENTITY];
        if (!sonosData || !sonosData.children) {
            console.log('No favorites children found');
            showPlaylistEmptyState();
            return;
        }
        
        const playlistsFolder = sonosData.children.find(c => 
            c.title === 'Playlists' || c.media_content_type === 'favorites_folder'
        );
        
        if (!playlistsFolder) {
            // Maybe playlists are directly in favorites - use them
            const directPlaylists = sonosData.children.filter(c => c.can_play);
            if (directPlaylists.length > 0) {
                spotifyPlaylists = directPlaylists.map(item => ({
                    id: item.media_content_id,
                    title: item.title,
                    thumbnail: item.thumbnail || '',
                    canPlay: item.can_play,
                    contentType: item.media_content_type
                }));
                renderPlaylistCarousel();
                return;
            }
            showPlaylistEmptyState();
            return;
        }
        
        // Step 2: Browse into the Playlists folder
        const playlistResponse = await fetch(`http://${HA_IP}/api/services/media_player/browse_media?return_response`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: SONOS_ENTITY,
                media_content_type: playlistsFolder.media_content_type,
                media_content_id: playlistsFolder.media_content_id
            })
        });
        
        if (!playlistResponse.ok) {
            console.log('browse_media playlists folder failed:', playlistResponse.status);
            showPlaylistEmptyState();
            return;
        }
        
        const playlistData = await playlistResponse.json();
        console.log('Playlists folder response:', playlistData);
        
        const playlistSonosData = playlistData.service_response && playlistData.service_response[SONOS_ENTITY];
        if (!playlistSonosData || !playlistSonosData.children) {
            console.log('No playlists found in folder');
            showPlaylistEmptyState();
            return;
        }
        
        // Map the playlists
        spotifyPlaylists = playlistSonosData.children.filter(item => item.can_play).map(item => ({
            id: item.media_content_id,
            title: item.title,
            thumbnail: item.thumbnail || '',
            canPlay: item.can_play,
            contentType: item.media_content_type
        }));
        
        console.log(`Found ${spotifyPlaylists.length} playlists`);
        renderPlaylistCarousel();
        
    } catch (e) {
        console.error('Failed to fetch playlists:', e);
        showPlaylistEmptyState();
    }
}

// Generate a consistent dark muted color based on a string (title)
function generatePastelFromString(str) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    // Use hash to generate HSL color - darker, more muted
    const hue = Math.abs(hash) % 360;
    const saturation = 25 + (Math.abs(hash >> 8) % 25); // 25-50% (muted)
    const lightness = 25 + (Math.abs(hash >> 16) % 15);  // 25-40% (dark range)
    
    return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.5)`;
}

// Extract dominant color from an image (with fallback to string-based color)
function extractDominantColor(imageUrl, title = '') {
    return new Promise((resolve) => {
        // Check cache first
        const cacheKey = imageUrl || title;
        if (playlistColors[cacheKey]) {
            resolve(playlistColors[cacheKey]);
            return;
        }
        
        // If no image URL, use title-based color
        if (!imageUrl) {
            const color = generatePastelFromString(title);
            playlistColors[cacheKey] = color;
            resolve(color);
            return;
        }
        
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        
        let resolved = false;
        
        img.onload = function() {
            if (resolved) return;
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Sample at small size for performance
                canvas.width = 50;
                canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);
                
                const imageData = ctx.getImageData(0, 0, 50, 50);
                const data = imageData.data;
                
                let r = 0, g = 0, b = 0, count = 0;
                
                // Sample every 4th pixel for speed
                for (let i = 0; i < data.length; i += 16) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
                
                if (count > 0) {
                    r = Math.round(r / count);
                    g = Math.round(g / count);
                    b = Math.round(b / count);
                }
                
                // Convert to pastel with transparency
                const pastel = toPastel(r, g, b);
                playlistColors[cacheKey] = pastel;
                resolved = true;
                resolve(pastel);
            } catch (e) {
                // CORS or other error - use title-based color
                console.log('Color extraction failed for', title, '- using generated color');
                const color = generatePastelFromString(title || imageUrl);
                playlistColors[cacheKey] = color;
                resolved = true;
                resolve(color);
            }
        };
        
        img.onerror = function() {
            if (resolved) return;
            const color = generatePastelFromString(title || imageUrl);
            playlistColors[cacheKey] = color;
            resolved = true;
            resolve(color);
        };
        
        // Handle HA proxy URLs
        if (imageUrl.startsWith('/')) {
            img.src = `http://${HA_IP}${imageUrl}`;
        } else {
            img.src = imageUrl;
        }
        
        // Timeout fallback - use title-based color
        setTimeout(() => {
            if (!resolved) {
                const color = generatePastelFromString(title || imageUrl);
                playlistColors[cacheKey] = color;
                resolved = true;
                resolve(color);
            }
        }, 1500);
    });
}

// Convert RGB to darker muted version with transparency
function toPastel(r, g, b) {
    // Darken and desaturate for muted dark tones
    // Mix with dark gray to create muted dark color
    const darkMix = 0.6; // 60% dark mix
    const targetDark = 40; // Target dark value
    
    const mutedR = Math.round(r * (1 - darkMix) + targetDark * darkMix);
    const mutedG = Math.round(g * (1 - darkMix) + targetDark * darkMix);
    const mutedB = Math.round(b * (1 - darkMix) + targetDark * darkMix);
    
    return `rgba(${mutedR}, ${mutedG}, ${mutedB}, 0.5)`;
}

// Render playlist carousel
async function renderPlaylistCarousel() {
    const carousel = document.getElementById('playlist-carousel');
    if (!carousel) return;
    
    if (spotifyPlaylists.length === 0) {
        showPlaylistEmptyState();
        return;
    }
    
    carousel.innerHTML = '';
    
    for (const playlist of spotifyPlaylists) {
        const tile = document.createElement('div');
        tile.className = 'playlist-tile';
        tile.dataset.playlistId = playlist.id;
        
        // Check if this is the currently playing playlist
        if (currentPlayingPlaylistId && playlist.id === currentPlayingPlaylistId) {
            tile.classList.add('now-playing');
        }
        
        // Get pastel background color based on thumbnail or title
        const bgColor = await extractDominantColor(playlist.thumbnail, playlist.title);
        tile.style.backgroundColor = bgColor;
        
        // Build tile HTML
        tile.innerHTML = `
            <div class="playlist-tile-art">
                ${playlist.thumbnail 
                    ? `<img src="${playlist.thumbnail.startsWith('/') ? 'http://' + HA_IP + playlist.thumbnail : playlist.thumbnail}" alt="${playlist.title}" onerror="this.parentElement.innerHTML='<div class=\\'playlist-tile-placeholder\\'>🎵</div>'">` 
                    : '<div class="playlist-tile-placeholder">🎵</div>'
                }
            </div>
            <div class="playlist-tile-title">${playlist.title}</div>
            <div class="playlist-tile-playing">
                <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </div>
        `;
        
        // Add click handler
        tile.addEventListener('click', () => playPlaylist(playlist));
        
        carousel.appendChild(tile);
    }
}

// Show empty state
function showPlaylistEmptyState() {
    const carousel = document.getElementById('playlist-carousel');
    if (!carousel) return;
    
    carousel.innerHTML = '<div class="playlist-carousel-loading">No playlists found</div>';
}

// Play a playlist
async function playPlaylist(playlist) {
    console.log('Playing playlist:', playlist.title);
    
    try {
        // Update UI immediately
        currentPlayingPlaylistId = playlist.id;
        updatePlaylistNowPlaying();
        
        // Send play command to Sonos via HA
        const response = await fetch(`http://${HA_IP}/api/services/media_player/play_media`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${TOKEN}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ 
                entity_id: SONOS_ENTITY,
                media_content_type: playlist.contentType || 'playlist',
                media_content_id: playlist.id
            })
        });
        
        if (!response.ok) {
            console.error('Failed to play playlist:', response.status);
        } else {
            console.log('Playlist playback started');
            // Refresh media player state after a short delay
            setTimeout(updateMediaPlayer, 1000);
        }
    } catch (e) {
        console.error('Error playing playlist:', e);
    }
}

// Update now playing indicator on tiles
function updatePlaylistNowPlaying() {
    const tiles = document.querySelectorAll('.playlist-tile');
    tiles.forEach(tile => {
        if (tile.dataset.playlistId === currentPlayingPlaylistId) {
            tile.classList.add('now-playing');
        } else {
            tile.classList.remove('now-playing');
        }
    });
}

// Detect currently playing playlist from media player state
function detectCurrentPlaylist() {
    if (!sonosState || !sonosState.attributes) return;
    
    const currentPlaylist = sonosState.attributes.media_playlist || 
                           sonosState.attributes.media_content_id || 
                           sonosState.attributes.queue_name || '';
    
    // Try to match with loaded playlists
    for (const playlist of spotifyPlaylists) {
        if (playlist.title === currentPlaylist || playlist.id === currentPlaylist) {
            if (currentPlayingPlaylistId !== playlist.id) {
                currentPlayingPlaylistId = playlist.id;
                updatePlaylistNowPlaying();
            }
            return;
        }
    }
}

// ============================================
// WEBOS SCREEN ROTATION SUPPORT
// ============================================

function handleOrientationChange(orientation) {
    console.log('Screen orientation changed to:', orientation);
    if (typeof webOSSystem !== 'undefined') {
        webOSSystem.setWindowOrientation(orientation);
    }
    document.body.style.display = 'none';
    document.body.offsetHeight;
    document.body.style.display = '';
}

document.addEventListener('screenOrientationChange', function(event) {
    handleOrientationChange(event.screenOrientation);
});

window.addEventListener('resize', function() {
    console.log('Window resized:', window.innerWidth, 'x', window.innerHeight);
});

document.addEventListener('focus', function() {
    if (typeof webOSSystem !== 'undefined' && webOSSystem.screenOrientation) {
        webOSSystem.setWindowOrientation(webOSSystem.screenOrientation);
    }
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        applySettings();
        if (typeof webOSSystem !== 'undefined') {
            webOSSystem.setWindowOrientation(webOSSystem.screenOrientation);
        }
    }
});

// ============================================
// INITIALIZATION
// ============================================

function preventSystemUI(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
}

document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
});

document.addEventListener('DOMContentLoaded', () => {
    if (typeof webOSSystem !== 'undefined') {
        console.log('Running on webOS, setting up rotation support');
        webOSSystem.setWindowOrientation(webOSSystem.screenOrientation);
        
        try {
            if (webOSSystem.setInputMethod) {
                webOSSystem.setInputMethod('none');
            }
            if (webOSSystem.setProperty) {
                webOSSystem.setProperty('virtualKeyboard', false);
            }
            if (webOSSystem.setCursorVisibility) {
                webOSSystem.setCursorVisibility(false);
            }
            if (webOSSystem.setProperty) {
                webOSSystem.setProperty('virtualRemote', false);
            }
        } catch (e) {
            console.log('webOS API calls:', e);
        }
    }

    window.addEventListener('load', function() {
        if (typeof webOSSystem !== 'undefined') {
            try {
                if (webOSSystem.setInputMethod) {
                    webOSSystem.setInputMethod('none');
                }
                if (webOSSystem.setProperty) {
                    webOSSystem.setProperty('virtualKeyboard', false);
                    webOSSystem.setProperty('virtualRemote', false);
                }
                if (webOSSystem.setCursorVisibility) {
                    webOSSystem.setCursorVisibility(false);
                }
            } catch (e) {
                console.log('webOS load API calls:', e);
            }
        }
        applySettings();
    });

    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            settings = { ...settings, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.log('Could not load settings:', e);
    }
    applySettings();
    
    function updateClock() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        document.getElementById('clock').textContent = `${displayHours}:${minutes} ${ampm}`;
    }
    
    updateClock();
    updateWeather();
    updateSonos();
    
    // Fetch playlists after initial media player update
    setTimeout(() => {
        fetchSpotifyPlaylists();
    }, 2000);
    
    setInterval(updateClock, 1000);
    setInterval(updateWeather, 300000);
    setInterval(updateSonos, 5000);
    
    // Refresh playlists every 10 minutes
    setInterval(fetchSpotifyPlaylists, 600000);
});

