# Jarvis Voice Routing Reliability Fix - 2026-07-01

## Goal

Jarvis should use the Pi microphone and Pi speaker, but route processing and high-quality voice through the laptop whenever the laptop is available. If the laptop is unavailable, the Pi/Home Assistant path remains the fallback.

## Symptoms

- Wake false positives triggered Jarvis without a real command.
- `Hey Jarvis, turn off the music` was transcribed correctly but played music instead.
- `Hey Jarvis, play something else` and `Hey Jarvis, change the music` were sometimes ignored by the first-turn coherence gate.
- In realtime mode, Jarvis sometimes changed music while saying a generic clarification prompt.
- Some spoken acknowledgements were cut off after 2-3 seconds.

## Root Causes

- Coherence was originally checked by local regex in `jarvis-wake.py`, which was too brittle for natural follow-up phrases.
- `JARVIS_NATIVE_COMMANDS=true` used laptop routing but Pi/Home Assistant default TTS. The laptop high-quality voice path needs `JARVIS_NATIVE_COMMANDS=realtime`.
- Fast media routing did not cover phrases such as `turn off the music`, `play something else`, `change the music`, and `switch the song`.
- Direct realtime actions were letting the realtime model respond from conversational context instead of reading the router acknowledgement exactly.
- Exact acknowledgement generation had too small a token cap, truncating longer playlist names.
- Pi realtime playback was closed too aggressively before buffered audio had fully drained.

## Fixes

- Added/kept a laptop heartbeat to Home Assistant every 2 seconds, with a 6 second TTL.
- Switched wake handling to realtime laptop voice streamed to the Pi speaker.
- Added Hermes-backed coherence via the laptop router `/coherence` endpoint, with local regex fallback.
- Added a 90 second follow-up wake grace window after successful interactions.
- Added wake, working, and rejected-coherence chimes.
- Hardened fast media routing:
  - stop/off music -> `media_player.media_pause`
  - play something else / another / different -> Sonos recommendation
  - change the music -> Sonos recommendation
  - switch/change song or track -> next track
- Forced direct home/media actions to speak the router acknowledgement exactly.
- Increased exact-response token budget to avoid truncation.
- Drained Pi realtime playback before closing the stream.
- Added a narrow transcript correction for `James the music` -> `change the music`.

## Important Settings

See `scripts/jarvis-router.env.example` for a sanitized copy of the production-relevant settings. The live `~/.hermes/jarvis-router.env` contains secrets and must not be committed.

Core settings:

```env
JARVIS_MIC_SOURCE=pi
JARVIS_SPEECH_OUTPUT=pi
JARVIS_NATIVE_COMMANDS=realtime
JARVIS_COHERENCE_SOURCE=hermes
JARVIS_FOLLOWUP_WAKE_GRACE_SECONDS=90.0
JARVIS_REALTIME_PLAYBACK_DRAIN_EXTRA_SECONDS=1.0
```

## Validation

- `node --check ~/.hermes/scripts/jarvis-router.js`
- `python3 -m py_compile ~/.hermes/scripts/jarvis-wake.py`
- Router dry-runs verified:
  - `Hey Jarvis, turn off the music` -> fast pause Sonos
  - `Hey Jarvis, play something else` -> fast Sonos recommendation
  - `Hey Jarvis, change the music` -> fast Sonos recommendation
  - `switch the song` -> fast next-track action
- Hermes coherence verified:
  - accepts `Hey Jarvis, change the music`
  - accepts `Hey Jarvis, play something else`
  - rejects background speech such as `there is whiskey in the afternoon`
