# Jarvis Sonos Volume Fix - 2026-06-13

## Symptom

Jarvis volume commands for `media_player.sonos` looked random. A command such as "set the volume to 20 percent" would sometimes work, sometimes revert to an older requested amount, and sometimes visibly jump in the Sonos app after the command completed.

## Root Cause

There were several overlapping issues:

- The dashboard/WebOS volume helpers accepted only simple slider values and could mis-handle speech-style inputs.
- Jarvis voice handling ducked Sonos volume while listening and later restored the old volume.
- The active path was the realtime laptop voice session in `/Users/santiarano/.hermes/scripts/jarvis-router.js`, not the native wake path. Its `/sonos-restore` endpoint could overwrite a just-executed volume command.
- Old delayed restore/reassert operations could run after a newer command and set Sonos to a stale volume.

## Fix

In this repo:

- `app.js` now validates and normalizes volume levels/deltas before calling Home Assistant.
- `webos-app/app.js` now normalizes direct volume inputs such as `35`, `35%`, `volume 35`, and `0.35`.
- Invalid volume state no longer falls back to zero.

In the live Jarvis scripts:

- `/Users/santiarano/.hermes/scripts/jarvis-router.js` now treats Sonos volume commands as authoritative.
- `/sonos-restore` skips stale restore calls after a recent Sonos volume command.
- The latest requested volume is reasserted briefly with a generation id, so older delayed work cannot win after a newer command.
- `/Users/santiarano/.hermes/scripts/jarvis-wake.py` was also hardened for the native wake path.
- The duplicate `ai.jarvis.wake` LaunchAgent was disabled, leaving `ai.jarvis.wake-app` plus `ai.jarvis.router` running.

## Verification

- `node --check app.js`
- `node --check webos-app/app.js`
- `node --check /Users/santiarano/.hermes/scripts/jarvis-router.js`
- `python3 -m py_compile /Users/santiarano/.hermes/scripts/jarvis-wake.py`
- Simulated stale `/sonos-restore` calls after a volume command; stale restores were skipped and Sonos stayed at the requested volume.

## Operational Note

The most important fix lives outside this repository in `~/.hermes/scripts`. If those scripts are replaced or regenerated, preserve the Sonos restore guard and generation-based volume reassert logic.
