#!/usr/bin/env python3

import argparse
import asyncio
import base64
import io
import json
import math
import os
import queue
import subprocess
import threading
import time
import urllib.request
import wave
from collections import deque

import numpy as np
import requests
import sounddevice as sd
from openwakeword.model import Model
from openwakeword.utils import download_models
from scipy.signal import resample_poly

try:
    import websockets
except ImportError:
    websockets = None


def log(message, **data):
    suffix = f" {json.dumps(data)}" if data else ""
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}{suffix}", flush=True)


def post_wake(url):
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        return response.read().decode("utf-8")


def post_notify(url, event, data):
    try:
        requests.post(url, json={"event": event, "data": data}, timeout=3)
    except Exception as error:
        log("Notify failed", error=str(error))


def post_json(url, payload=None, timeout=3):
    response = requests.post(url, json=payload or {}, timeout=timeout)
    if response.status_code >= 400:
        raise RuntimeError(f"POST {url} failed {response.status_code}: {response.text[:200]}")
    return response.json() if response.text else {}


def load_env_file(path, override=False):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and (override or key not in os.environ):
                    os.environ[key] = value
    except FileNotFoundError:
        return


def wav_bytes(audio, sample_rate):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio.astype(np.int16).tobytes())
    return buffer.getvalue()


def rms(audio):
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio.astype(np.float32)))))


def record_command(audio_queue, sample_rate, blocksize, max_seconds=7.0, min_seconds=1.2):
    chunks = []
    started = time.monotonic()
    last_loud = started
    silence_threshold = 240.0
    silence_seconds = 1.1

    while True:
        try:
            chunk = audio_queue.get(timeout=0.5).reshape(-1)
        except queue.Empty:
            chunk = np.zeros(blocksize, dtype=np.int16)

        chunks.append(chunk)
        now = time.monotonic()
        elapsed = now - started
        level = rms(chunk)

        if elapsed > 0.35 and level >= silence_threshold:
            last_loud = now

        if elapsed >= min_seconds and now - last_loud >= silence_seconds:
            break
        if elapsed >= max_seconds:
            break

    audio = np.concatenate(chunks) if chunks else np.array([], dtype=np.int16)
    return audio


def drain_audio_queue(audio_queue):
    drained = 0
    while True:
        try:
            audio_queue.get_nowait()
            drained += 1
        except queue.Empty:
            return drained


def start_pi_audio_reader(audio_queue, args, stop_event):
    remote_command = [
        "arecord",
        "-r",
        str(args.samplerate),
        "-c",
        "1",
        "-f",
        "S16_LE",
        "-t",
        "raw",
    ]
    ssh_command = [
        "ssh",
        "-i",
        args.pi_ssh_key,
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        f"{args.pi_ssh_user}@{args.pi_ssh_host}",
        " ".join(remote_command),
    ]
    bytes_per_chunk = args.blocksize * 2

    def run():
        notified_connected = False
        last_heartbeat = 0.0
        while not stop_event.is_set():
            process = None
            try:
                log("Pi mic stream starting", host=args.pi_ssh_host, user=args.pi_ssh_user)
                process = subprocess.Popen(
                    ssh_command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    bufsize=0,
                )

                def log_stderr():
                    if not process or not process.stderr:
                        return
                    for raw_line in iter(process.stderr.readline, b""):
                        text = raw_line.decode("utf-8", errors="replace").strip()
                        if text:
                            log("Pi mic stream stderr", line=text[:300])

                threading.Thread(target=log_stderr, daemon=True).start()
                log("Pi mic stream ready")
                notified_connected = post_pi_connection_state(
                    args,
                    connected=True,
                    announce=not notified_connected,
                ) or notified_connected
                last_heartbeat = time.monotonic()

                while not stop_event.is_set() and process.stdout:
                    chunk = process.stdout.read(bytes_per_chunk)
                    if not chunk:
                        break
                    usable = len(chunk) - (len(chunk) % 2)
                    if usable <= 0:
                        continue
                    audio = np.frombuffer(chunk[:usable], dtype=np.int16).copy()
                    if args.pi_mic_gain != 1.0:
                        audio = np.clip(
                            audio.astype(np.float32) * args.pi_mic_gain,
                            -32768,
                            32767,
                        ).astype(np.int16)
                    audio_queue.put(audio)
                    now = time.monotonic()
                    if now - last_heartbeat >= 30.0:
                        notified_connected = post_pi_connection_state(
                            args,
                            connected=True,
                            announce=not notified_connected,
                        ) or notified_connected
                        last_heartbeat = now

                code = process.poll()
                if code is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                log("Pi mic stream stopped", code=process.poll())
                post_pi_connection_state(
                    args,
                    connected=False,
                    error=f"Pi mic stream stopped with code {process.poll()}",
                )
                notified_connected = False
            except Exception as error:
                log("Pi mic stream failed", error=str(error))
                post_pi_connection_state(args, connected=False, error=str(error))
                notified_connected = False
                if process and process.poll() is None:
                    try:
                        process.kill()
                    except Exception:
                        pass
            if not stop_event.is_set():
                time.sleep(2)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


def transcribe(audio, sample_rate, model):
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("replace-with-"):
        raise RuntimeError("OPENAI_API_KEY is not configured")

    files = {
        "file": ("jarvis-command.wav", wav_bytes(audio, sample_rate), "audio/wav"),
    }
    data = {"model": model}
    response = requests.post(
        "https://api.openai.com/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {api_key}"},
        data=data,
        files=files,
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Transcription failed {response.status_code}: {response.text[:200]}")
    payload = response.json()
    return str(payload.get("text", "")).strip()


def route_command(router_url, text):
    response = requests.post(
        router_url,
        json={"text": text, "dry_run": False, "source": "native-wake"},
        timeout=30,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Router failed {response.status_code}: {response.text[:200]}")
    return response.json()


def router_coherence_check(args, text, context=None):
    payload = {"text": text, "source": "jarvis-wake"}
    if context:
        payload["context"] = context
    response = post_json(
        f"{router_base_url(args.command_url)}/coherence",
        payload,
        timeout=max(0.3, float(getattr(args, "coherence_timeout_seconds", 1.6))),
    )
    return bool(response.get("coherent")), response


def accept_initial_transcript(args, text, context=None):
    if context:
        return is_coherent_command_transcript(text, context=context)

    source = str(getattr(args, "coherence_source", "hermes") or "hermes").strip().lower()
    if source in {"hermes", "router", "laptop", "auto"}:
        try:
            coherent, decision = router_coherence_check(args, text, context=context)
            log(
                "Coherence checked by router",
                coherent=coherent,
                source=decision.get("source"),
                confidence=decision.get("confidence"),
                intent=decision.get("intent"),
                reason=str(decision.get("reason", ""))[:160],
            )
            return coherent
        except Exception as error:
            log("Router coherence unavailable; falling back to local gate", error=str(error))

    coherent = is_coherent_command_transcript(text, context=context)
    log("Coherence checked locally", coherent=coherent, gate=transcript_gate_label(text, context=context))
    return coherent


def clean_realtime_transcript(text):
    import re

    cleaned = str(text or "").strip()
    cleaned = cleaned.replace("’", "'")
    cleaned = cleaned.strip(" \t\r\n")
    cleaned = cleaned.replace("Hey, Jarvis", "Hey Jarvis")
    cleaned = cleaned.replace("Hej, Jarvis", "Hej Jarvis")
    cleaned = cleaned.replace("hey, Jarvis", "hey Jarvis")
    cleaned = cleaned.replace("hej, Jarvis", "hej Jarvis")
    cleaned = cleaned.replace("hey, jarvis", "hey jarvis")
    cleaned = cleaned.replace("hej, jarvis", "hej jarvis")
    cleaned = cleaned.replace("Hey, jarvis", "Hey jarvis")
    cleaned = cleaned.replace("Hej, jarvis", "Hej jarvis")
    cleaned = cleaned.strip()
    cleaned = cleaned.strip(".!? ")
    cleaned = cleaned.strip()
    cleaned = cleaned.replace("Hey Jarvis,", "Hey Jarvis")
    cleaned = cleaned.replace("Hej Jarvis,", "Hej Jarvis")
    cleaned = cleaned.replace("hey jarvis,", "hey jarvis")
    cleaned = cleaned.replace("hej jarvis,", "hej jarvis")
    for prefix in ("Hey Jarvis", "hey Jarvis", "Hey jarvis", "hey jarvis", "Hej Jarvis", "hej Jarvis", "Hej jarvis", "hej jarvis"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip(" ,.!?")
            break
    if re.fullmatch(r"james\s+(?:the\s+)?(?:music|song|track)", cleaned, flags=re.IGNORECASE):
        return "change the music"
    return cleaned.strip()


def is_wake_only_transcript(text):
    cleaned = clean_realtime_transcript(text).lower()
    return not cleaned or cleaned in {"jarvis", "hey", "hej", "hi", "hello"}


def is_initial_command_transcript(text):
    cleaned = clean_realtime_transcript(text)
    normalized = normalized_text(cleaned)
    if not normalized or is_wake_only_transcript(cleaned):
        return False

    if is_direct_home_transcript(cleaned):
        return True

    directed_request = (
        r"\b(can you|could you|would you|please|tell me|show me|find|search|"
        r"check|look up|what is|what's|whats|when is|where is|who is|why is|"
        r"how do|how can|remind me|create|add|list|read|open|send|message|"
        r"email|call|set a timer|timer|alarm|weather|time|calendar|schedule|"
        r"task|note)\b"
    )
    directed_request_es = (
        r"\b(puedes|podrias|podrías|por favor|dime|muestrame|muéstrame|busca|"
        r"comprueba|revisa|que es|qué es|cuando|cuándo|donde|dónde|quien|quién|"
        r"por que|por qué|como|cómo|recuerdame|recuérdame|crea|anade|añade|"
        r"lista|lee|abre|envia|envía|mensaje|correo|tiempo|hora|calendario|"
        r"tarea|nota)\b"
    )
    return re_search(directed_request, normalized) or re_search(directed_request_es, normalized)


def is_vague_music_change_transcript(text):
    cleaned = normalized_text(text)
    if not cleaned:
        return False

    music_verb = r"\b(play|put on|start|change|switch|choose|pick|pon|poner|reproduce|cambia|elige|escoge)\b"
    vague_target = (
        r"\b(something|anything|something else|another|another one|different|"
        r"new|fresh|otra cosa|algo|algo nuevo|diferente|otro|otra)\b"
    )
    return re_search(music_verb, cleaned) and re_search(vague_target, cleaned)


def is_coherent_command_transcript(text, context=None):
    cleaned = clean_realtime_transcript(text)
    normalized = normalized_text(cleaned)
    if not normalized or is_wake_only_transcript(cleaned):
        return False

    if context:
        return True

    return is_initial_command_transcript(cleaned) or is_vague_music_change_transcript(cleaned)


def transcript_gate_label(text, context=None):
    if context:
        return "conversation"
    return "initial"


def normalized_text(text):
    import re

    text = clean_realtime_transcript(text).lower()
    text = re.sub(r"[^a-z0-9áéíóúüñç ]+", " ", text, flags=re.IGNORECASE)
    return " ".join(text.split())


def is_self_echo_transcript(transcript, state):
    if not state:
        return False
    assistant_text = state.get("last_assistant_text", "")
    assistant_at = state.get("last_assistant_text_at", 0.0)
    if not assistant_text or time.monotonic() - assistant_at > 12.0:
        return False

    heard = normalized_text(transcript)
    said = normalized_text(assistant_text)
    if not heard or not said:
        return False
    if heard == said or heard in said:
        return True
    if said in heard and len(heard.split()) <= len(said.split()) + 2:
        return True

    heard_words = heard.split()
    said_words = set(said.split())
    if len(heard_words) < 4 or not said_words:
        return False
    overlap = sum(1 for word in heard_words if word in said_words)
    return overlap / max(1, len(heard_words)) >= 0.78


def is_direct_home_transcript(text):
    cleaned = clean_realtime_transcript(text).lower()
    if not cleaned:
        return False

    if is_vague_music_change_transcript(cleaned):
        return True

    home_keyword = (
        r"\b(projector|proyector|projection|screen|pantalla|tray|bandeja|"
        r"tv|television|tele|apple tv|awning|toldo|shade|sombra|"
        r"light|lights|luces|luz|sonos|music|musica|música|song|track|"
        r"speaker|volume|volumen|playlist|radio)\b"
    )
    command_word = (
        r"\b(turn|switch|set|open|close|lower|raise|deploy|retract|start|stop|"
        r"play|pause|resume|continue|change|changing|skip|next|previous|dim|brighter|louder|"
        r"quieter|on|off|up|down|enciende|encender|prende|apaga|apagar|abre|"
        r"abrir|cierra|cerrar|baja|bajar|sube|subir|pon|poner|reproduce|"
        r"pausa|para|reanuda|sigue|continua|continúa|cambia|cambiar|siguiente|anterior)\b"
    )
    if not re_search(home_keyword, cleaned):
        return False
    if re_search(command_word, cleaned):
        return True
    return re_search(r"\b(movie mode|film mode|cine|cinema|cozy|acogedor|acogedora)\b", cleaned)


def re_search(pattern, text):
    import re

    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def fetch_realtime_session_config(args):
    response = requests.get(
        f"{router_base_url(args.command_url)}/realtime-session-config",
        timeout=5,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Realtime config failed {response.status_code}: {response.text[:200]}")

    payload = response.json()
    session = payload.get("session")
    if not isinstance(session, dict):
        raise RuntimeError("Realtime config did not include a session object")

    session = json.loads(json.dumps(session))
    session["type"] = "realtime"
    session["model"] = args.realtime_model
    session["output_modalities"] = ["audio"]

    instructions = str(session.get("instructions") or "")
    wake_context = (
        "The wake word has already been detected. Ignore the words 'hey Jarvis' if they are present "
        "in the incoming audio. Listen for the actual command after the wake word. If the user only "
        "said the wake word, wait silently for the actual command. Explicit home automation commands are handled "
        "by a local transcript router before you respond. Do not infer or invent lights, TV, projector, "
        "screen, tray, awning, Sonos, or music actions from uncertain transcripts."
    )
    session["instructions"] = f"{instructions}\n\n{wake_context}".strip()

    audio = session.setdefault("audio", {})
    audio["input"] = {
        "format": {"type": "audio/pcm", "rate": args.realtime_sample_rate},
        "transcription": {"model": args.transcription_model},
        "turn_detection": {
            "type": "server_vad",
            "threshold": args.realtime_vad_threshold,
            "prefix_padding_ms": 300,
            "silence_duration_ms": args.realtime_vad_silence_ms,
            "create_response": False,
            "interrupt_response": True,
        },
    }
    output = audio.setdefault("output", {})
    output["voice"] = args.realtime_voice
    output["format"] = {"type": "audio/pcm", "rate": args.realtime_sample_rate}
    if not enabled(getattr(args, "allow_model_home_tools", "false")):
        session["tool_choice"] = "none"
    return session


def resample_int16(audio, source_rate, target_rate):
    audio = np.asarray(audio, dtype=np.int16).reshape(-1)
    if source_rate == target_rate:
        return audio

    divisor = math.gcd(int(source_rate), int(target_rate))
    up = int(target_rate) // divisor
    down = int(source_rate) // divisor
    resampled = resample_poly(audio.astype(np.float32), up, down)
    return np.clip(resampled, -32768, 32767).astype(np.int16)


def enabled(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def disabled(value):
    return str(value).strip().lower() in {"0", "false", "no", "off"}


def audio_cues_enabled(args):
    return enabled(getattr(args, "audio_cues", "true")) and getattr(args, "speech_output", "") == "pi"


def fade_edges(audio, sample_rate, attack=0.012, release=0.08):
    audio = np.asarray(audio, dtype=np.float32).copy()
    if audio.size == 0:
        return audio

    attack_samples = min(audio.size, max(1, int(sample_rate * attack)))
    release_samples = min(audio.size, max(1, int(sample_rate * release)))
    audio[:attack_samples] *= np.linspace(0.0, 1.0, attack_samples, dtype=np.float32)
    audio[-release_samples:] *= np.linspace(1.0, 0.0, release_samples, dtype=np.float32)
    return audio


def pcm_from_float(audio):
    return np.clip(audio, -1.0, 1.0).astype(np.float32)


def make_wake_chime(sample_rate, gain):
    duration = 0.42
    count = int(sample_rate * duration)
    t = np.arange(count, dtype=np.float32) / sample_rate
    audio = np.zeros(count, dtype=np.float32)

    for onset, freq, amp, decay in (
        (0.00, 880.0, 0.72, 7.4),
        (0.08, 1174.66, 0.58, 8.5),
        (0.11, 1760.0, 0.16, 10.0),
    ):
        mask = t >= onset
        local = t[mask] - onset
        audio[mask] += amp * np.sin(2 * math.pi * freq * local) * np.exp(-decay * local)

    audio = fade_edges(audio, sample_rate, attack=0.006, release=0.16)
    peak = max(0.001, float(np.max(np.abs(audio))))
    audio = audio / peak * max(0.0, min(1.0, gain))
    return (pcm_from_float(audio) * 32767).astype(np.int16)


def make_working_cue(sample_rate, gain):
    duration = 0.58
    count = int(sample_rate * duration)
    t = np.arange(count, dtype=np.float32) / sample_rate
    audio = np.zeros(count, dtype=np.float32)

    for onset, freq, amp, decay in (
        (0.00, 392.0, 0.42, 4.8),
        (0.06, 523.25, 0.36, 5.4),
        (0.15, 659.25, 0.18, 6.6),
    ):
        mask = t >= onset
        local = t[mask] - onset
        audio[mask] += amp * np.sin(2 * math.pi * freq * local) * np.exp(-decay * local)

    breath = 0.035 * np.sin(2 * math.pi * 174.61 * t + 0.25 * np.sin(2 * math.pi * 1.2 * t))
    audio += breath
    audio = fade_edges(audio, sample_rate, attack=0.08, release=0.18)
    peak = max(0.001, float(np.max(np.abs(audio))))
    audio = audio / peak * max(0.0, min(1.0, gain))
    return (pcm_from_float(audio) * 32767).astype(np.int16)


def make_error_cue(sample_rate, gain):
    duration = 0.34
    count = int(sample_rate * duration)
    t = np.arange(count, dtype=np.float32) / sample_rate
    audio = np.zeros(count, dtype=np.float32)

    for onset, freq, amp, decay in (
        (0.00, 392.0, 0.38, 8.0),
        (0.11, 293.66, 0.42, 8.5),
    ):
        mask = t >= onset
        local = t[mask] - onset
        audio[mask] += amp * np.sin(2 * math.pi * freq * local) * np.exp(-decay * local)

    audio = fade_edges(audio, sample_rate, attack=0.01, release=0.12)
    peak = max(0.001, float(np.max(np.abs(audio))))
    audio = audio / peak * max(0.0, min(1.0, gain))
    return (pcm_from_float(audio) * 32767).astype(np.int16)


def start_pi_pcm_playback(args, sample_rate, client_name, stream_name, latency_ms=80):
    remote_command = [
        "PULSE_SERVER=unix:/run/audio/pulse.sock",
        "pacat",
        "--playback",
        "--raw",
        "--format=s16le",
        f"--rate={sample_rate}",
        "--channels=1",
        f"--latency-msec={latency_ms}",
        f"--client-name={client_name}",
        f"--stream-name={stream_name}",
    ]
    ssh_command = [
        "ssh",
        "-i",
        args.pi_ssh_key,
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        f"{args.pi_ssh_user}@{args.pi_ssh_host}",
        " ".join(remote_command),
    ]
    process = subprocess.Popen(
        ssh_command,
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )

    def log_stderr():
        if not process.stderr:
            return
        for raw_line in iter(process.stderr.readline, b""):
            text = raw_line.decode("utf-8", errors="replace").strip()
            if text:
                log(f"{stream_name} stderr", line=text[:300])

    threading.Thread(target=log_stderr, daemon=True).start()
    log(f"{stream_name} ready", rate=sample_rate)
    return process


def start_pi_realtime_playback(args):
    return start_pi_pcm_playback(
        args,
        args.realtime_sample_rate,
        "JarvisRealtime",
        "JarvisRealtime",
    )


def finish_pcm_playback(process, name, timeout=3):
    if not process:
        return
    try:
        if process.stdin:
            process.stdin.close()
    except Exception:
        pass
    if process.poll() is None:
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
        except Exception:
            pass
    log(f"{name} finished", code=process.poll())


def stop_process(process, name):
    if not process:
        return
    try:
        if process.stdin:
            process.stdin.end()
    except Exception:
        pass
    if process.poll() is None:
        try:
            process.terminate()
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
        except Exception:
            pass
    log(f"{name} stopped", code=process.poll())


def play_pi_pcm_once(args, audio, sample_rate, name):
    if not audio_cues_enabled(args):
        return
    process = None
    try:
        process = start_pi_pcm_playback(args, sample_rate, name, name, latency_ms=45)
        if process.stdin:
            process.stdin.write(np.asarray(audio, dtype=np.int16).tobytes())
            process.stdin.flush()
    except Exception as error:
        log(f"{name} failed", error=str(error))
    finally:
        finish_pcm_playback(process, name)


def play_wake_chime(args):
    if not audio_cues_enabled(args):
        return

    def run():
        audio = make_wake_chime(args.realtime_sample_rate, args.wake_chime_gain)
        play_pi_pcm_once(args, audio, args.realtime_sample_rate, "JarvisWakeChime")

    threading.Thread(target=run, daemon=True).start()


def play_error_chime(args):
    if not audio_cues_enabled(args):
        return

    def run():
        audio = make_error_cue(args.realtime_sample_rate, args.error_chime_gain)
        play_pi_pcm_once(args, audio, args.realtime_sample_rate, "JarvisErrorChime")

    threading.Thread(target=run, daemon=True).start()


def write_playback(playback, state, raw_audio):
    if not playback or not playback.stdin or playback.poll() is not None:
        return False
    lock = state.get("playback_lock")
    try:
        if lock:
            with lock:
                playback.stdin.write(raw_audio)
                playback.stdin.flush()
        else:
            playback.stdin.write(raw_audio)
            playback.stdin.flush()
        return True
    except Exception as error:
        log("Pi playback write failed", error=str(error))
        return False


def play_working_cue(playback, args, state):
    if not audio_cues_enabled(args) or not playback or playback.poll() is not None:
        return
    now = time.monotonic()
    if now - state.get("last_working_cue_at", 0.0) < args.working_cue_min_interval:
        return
    audio = make_working_cue(args.realtime_sample_rate, args.working_cue_gain)
    duration = audio.size / max(1, args.realtime_sample_rate)
    if write_playback(playback, state, audio.tobytes()):
        state["last_working_cue_at"] = now
        state["mute_until"] = max(
            state.get("mute_until", 0.0),
            time.monotonic() + duration + 0.25,
        )
        log("Working cue played")


def play_pi_working_cue_once(args):
    audio = make_working_cue(args.realtime_sample_rate, args.working_cue_gain)
    play_pi_pcm_once(args, audio, args.realtime_sample_rate, "JarvisWorkingCue")


def stop_thinking_cue(state):
    stop_event = state.get("thinking_cue_stop")
    if stop_event:
        stop_event.set()
    state["thinking_cue_stop"] = None


def parse_tool_args(value):
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except Exception:
        return {"utterance": str(value)}


def tool_call_from_realtime_event(event):
    item = event.get("item") if isinstance(event.get("item"), dict) else event
    name = item.get("name") or event.get("name")
    call_id = item.get("call_id") or event.get("call_id")
    arguments = item.get("arguments") or event.get("arguments")
    if name != "control_home" or not call_id:
        return None
    return {
        "call_id": call_id,
        "arguments": parse_tool_args(arguments),
    }


async def send_realtime_event(ws, payload):
    await ws.send(json.dumps(payload))


async def handle_realtime_tool_call(ws, event, args, handled_tool_calls, state=None, playback=None):
    tool_call = tool_call_from_realtime_event(event)
    if not tool_call:
        return False

    call_id = tool_call["call_id"]
    if call_id in handled_tool_calls:
        return True
    handled_tool_calls.add(call_id)

    call_args = tool_call["arguments"]
    utterance = " ".join(
        str(call_args.get(key, "")).strip()
        for key in ("utterance", "command", "intent")
        if str(call_args.get(key, "")).strip()
    ).strip()
    if not utterance:
        utterance = json.dumps(call_args)

    direct_guard_active = bool(state) and time.monotonic() < state.get("direct_route_guard_until", 0.0)
    if state and (state.get("direct_route_active") or direct_guard_active):
        log("Realtime tool call ignored; direct transcript route already handled", utterance=utterance, args=call_args)
        await send_realtime_event(
            ws,
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps({
                        "ok": True,
                        "route": "direct-transcript",
                        "spoken_response": "Already handled.",
                        "actions": [],
                    }),
                },
            },
        )
        return True

    if not enabled(getattr(args, "allow_model_home_tools", "false")):
        log(
            "Realtime tool call ignored; model home tools disabled",
            utterance=utterance,
            last_transcript=state.get("last_user_transcript", "") if state else "",
        )
        await send_realtime_event(
            ws,
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": json.dumps({
                        "ok": False,
                        "route": "blocked-model-tool",
                        "spoken_response": "I didn't catch that.",
                        "actions": [],
                    }),
                },
            },
        )
        return True

    log("Realtime tool call", utterance=utterance)
    await asyncio.to_thread(voice_light_cue, args, "thinking")
    if state is not None:
        await asyncio.to_thread(play_working_cue, playback, args, state)
    try:
        output = await asyncio.to_thread(route_command, args.command_url, utterance)
    except Exception as error:
        output = {"ok": False, "error": str(error)}

    await send_realtime_event(
        ws,
        {
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": json.dumps(output),
            },
        },
    )

    ack = str(output.get("spoken_response") or "Done.").strip()
    await send_realtime_event(
        ws,
        {
            "type": "response.create",
            "response": {
                "max_output_tokens": 64,
                "tool_choice": "none",
                "instructions": (
                    "Say only these exact words, then stop: "
                    + json.dumps(ack)
                    + ". No other words. Do not say 'if you need anything else' or 'let me know'."
                    if output.get("ok")
                    else "Briefly tell the user the home action failed."
                ),
            },
        },
    )
    return True


async def create_realtime_spoken_response(ws, instructions, max_output_tokens=96, allow_tools=False):
    response = {
        "max_output_tokens": max_output_tokens,
        "instructions": instructions,
        "tool_choice": "auto" if allow_tools else "none",
    }
    await send_realtime_event(
        ws,
        {
            "type": "response.create",
            "response": response,
        },
    )


async def create_exact_realtime_spoken_response(ws, text):
    exact = str(text or "").strip()
    if not exact:
        exact = "Done."
    try:
        await send_realtime_event(ws, {"type": "response.cancel"})
    except Exception:
        pass
    await send_realtime_event(
        ws,
        {
            "type": "conversation.item.create",
            "item": {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "For the next audio response, ignore all earlier user requests. "
                            "Read exactly this sentence aloud and then stop: "
                            + json.dumps(exact)
                        ),
                    },
                ],
            },
        },
    )
    await create_realtime_spoken_response(
        ws,
        (
            "You are only a speech renderer for this turn. "
            "Say exactly and only this sentence, then stop: "
            + json.dumps(exact)
            + ". Do not answer, ask questions, explain, or add any other words."
        ),
        max_output_tokens=160,
        allow_tools=False,
    )


async def route_realtime_transcript_direct(ws, transcript, args, state, playback=None):
    command = clean_realtime_transcript(transcript)
    if not command:
        return False

    state["direct_route_active"] = True
    state["direct_route_guard_until"] = time.monotonic() + max(0.0, args.direct_route_guard_seconds)
    state["last_direct_route_command"] = command
    state["close_after_response"] = True
    state["last_response_done"] = None
    log("Direct transcript route", text=command)
    await asyncio.to_thread(voice_light_cue, args, "thinking")
    await asyncio.to_thread(play_working_cue, playback, args, state)
    try:
        output = await asyncio.to_thread(route_command, args.command_url, command)
    except Exception as error:
        output = {"ok": False, "error": str(error)}
    state["last_route_ok"] = bool(output.get("ok", False))

    ack = str(output.get("spoken_response") or ("Done." if output.get("ok") else "Sorry, I couldn't do that.")).strip()
    post_notify(
        args.notify_url,
        "response",
        {
            "text": ack,
            "route": output.get("route", "direct-transcript"),
            "actions": len(output.get("actions", [])) if isinstance(output.get("actions"), list) else 0,
        },
    )
    await create_exact_realtime_spoken_response(
        ws,
        ack if output.get("ok", True) else "Sorry, I couldn't do that.",
    )
    return True


async def respond_to_realtime_transcript(ws, transcript, args, state, playback=None):
    cleaned = clean_realtime_transcript(transcript)
    if not cleaned:
        log("Realtime transcript ignored", reason="empty_after_wake", transcript=transcript)
        return

    if is_wake_only_transcript(transcript):
        log("Realtime transcript ignored", reason="wake_only", transcript=transcript)
        return

    if not state.get("conversation_established"):
        if not state.get("skip_initial_coherence") and not await asyncio.to_thread(accept_initial_transcript, args, transcript):
            log("Realtime transcript ignored", reason="incoherent_initial", transcript=transcript)
            await asyncio.to_thread(play_error_chime, args)
            state["closing"] = True
            return
        state["conversation_established"] = True
        if state.get("skip_initial_coherence"):
            log("Realtime initial coherence skipped", reason="recent_successful_wake", transcript=transcript)

    if is_direct_home_transcript(transcript):
        await route_realtime_transcript_direct(ws, transcript, args, state, playback)
        return

    state["last_response_done"] = None
    await create_realtime_spoken_response(
        ws,
        (
            "Respond naturally and concisely to the user's last message. "
            + (
                "If the message is a home automation request, call the control_home tool; "
                if enabled(getattr(args, "allow_model_home_tools", "false"))
                else "If the message sounds like a home automation request but you are not certain, ask the user to repeat it; do not call tools. "
            )
            + "Do not reinterpret projector, TV, screen, tray, awning, Sonos, or music commands as lights."
        ),
        max_output_tokens=256,
        allow_tools=enabled(getattr(args, "allow_model_home_tools", "false")),
    )


async def realtime_audio_sender(ws, audio_queue, args, state, pre_roll):
    start = time.monotonic()
    sent_chunks = 0

    for chunk in pre_roll or []:
        audio = resample_int16(chunk, args.samplerate, args.realtime_sample_rate)
        await send_realtime_event(
            ws,
            {
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(audio.tobytes()).decode("ascii"),
            },
        )
        sent_chunks += 1

    while not state["closing"]:
        now = time.monotonic()
        if now - start >= args.realtime_window_seconds:
            log("Realtime window closed", reason="max_seconds", sent_chunks=sent_chunks)
            state["closing"] = True
            break
        if state["last_response_done"] and now - state["last_response_done"] >= args.realtime_followup_window_seconds:
            log("Realtime window closed", reason="followup_timeout", sent_chunks=sent_chunks)
            state["closing"] = True
            break

        try:
            chunk = await asyncio.to_thread(audio_queue.get, True, 0.25)
        except queue.Empty:
            if not sent_chunks or state["last_response_done"]:
                continue
            chunk = np.zeros(args.blocksize, dtype=np.int16)

        if time.monotonic() < state["mute_until"]:
            continue

        audio = resample_int16(chunk, args.samplerate, args.realtime_sample_rate)
        await send_realtime_event(
            ws,
            {
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(audio.tobytes()).decode("ascii"),
            },
        )
        sent_chunks += 1


async def realtime_event_receiver(ws, args, state, playback):
    handled_tool_calls = set()
    assistant_text_parts = []

    async for raw_message in ws:
        event = json.loads(raw_message)
        event_type = event.get("type")
        state["last_event_at"] = time.monotonic()

        if event_type == "session.updated":
            log("Realtime session ready", model=args.realtime_model, voice=args.realtime_voice)
            ack_text = str(getattr(args, "wake_ack_text", "") or "").strip()
            if ack_text and not state.get("wake_ack_sent"):
                state["wake_ack_sent"] = True
                state["last_response_done"] = None
                await create_realtime_spoken_response(
                    ws,
                    (
                        "Say only these exact words, then stop: "
                        + json.dumps(ack_text)
                        + ". No other words."
                    ),
                    max_output_tokens=24,
                )
            continue

        if event_type == "input_audio_buffer.speech_started":
            if state.get("response_active"):
                try:
                    await send_realtime_event(ws, {"type": "response.cancel"})
                    log("Realtime response cancelled by user speech")
                except Exception as error:
                    log("Realtime response cancel failed", error=str(error))
                state["response_active"] = False
                state["mute_until"] = time.monotonic() + 0.25
            state["last_response_done"] = None
            await asyncio.to_thread(voice_light_cue, args, "listening")
            log("Realtime speech started")
            continue

        if event_type == "input_audio_buffer.speech_stopped":
            log("Realtime speech stopped")
            continue

        if event_type == "conversation.item.input_audio_transcription.completed":
            transcript = str(event.get("transcript") or "").strip()
            if transcript:
                state["last_user_transcript"] = transcript
                if is_self_echo_transcript(transcript, state):
                    log("Realtime transcript ignored", reason="self_echo", transcript=transcript)
                    continue
                log("Realtime heard", transcript=transcript)
                post_notify(args.notify_url, "transcript", {"text": transcript})
                transcript_key = event.get("item_id") or event.get("event_id") or transcript
                if transcript_key not in state["handled_transcripts"]:
                    state["handled_transcripts"].add(transcript_key)
                    await respond_to_realtime_transcript(ws, transcript, args, state, playback)
            continue

        if event_type == "response.created":
            state["response_active"] = True
            state["last_response_done"] = None
            state["audio_out_bytes"] = 0
            assistant_text_parts.clear()
            continue

        if event_type in {"response.output_audio.delta", "response.audio.delta"}:
            delta = event.get("delta") or event.get("audio") or ""
            if not delta:
                continue
            stop_thinking_cue(state)
            raw_audio = base64.b64decode(delta)
            state["audio_out_bytes"] += len(raw_audio)
            duration = len(raw_audio) / 2 / max(1, args.realtime_sample_rate)
            state["mute_until"] = max(
                state["mute_until"],
                time.monotonic() + duration + args.realtime_echo_guard_seconds,
            )
            await asyncio.to_thread(voice_light_cue, args, "speaking")
            write_playback(playback, state, raw_audio)
            continue

        if event_type in {"response.output_audio_transcript.delta", "response.audio_transcript.delta"}:
            delta = str(event.get("delta") or "")
            if delta:
                assistant_text_parts.append(delta)
            continue

        if event_type in {"response.output_audio_transcript.done", "response.audio_transcript.done"}:
            transcript = str(event.get("transcript") or "").strip()
            if transcript:
                assistant_text_parts = [transcript]
                state["last_assistant_text"] = transcript
                state["last_assistant_text_at"] = time.monotonic()
                log("Realtime response", text=transcript)
                post_notify(args.notify_url, "response", {"text": transcript, "route": "realtime", "actions": 0})
            continue

        if event_type in {"response.output_item.done", "response.function_call_arguments.done"}:
            handled = await handle_realtime_tool_call(ws, event, args, handled_tool_calls, state, playback)
            if handled:
                state["last_response_done"] = None
            continue

        if event_type == "response.done":
            stop_thinking_cue(state)
            state["response_active"] = False
            if time.monotonic() >= state.get("direct_route_guard_until", 0.0):
                state["direct_route_active"] = False
            state["last_response_done"] = time.monotonic()
            state["mute_until"] = max(state["mute_until"], time.monotonic() + args.realtime_echo_guard_seconds)
            text = "".join(assistant_text_parts).strip()
            if text:
                state["last_assistant_text"] = text
                state["last_assistant_text_at"] = time.monotonic()
            log("Realtime response done", audio_bytes=state["audio_out_bytes"], text=text[:160])
            if (
                state.get("conversation_established")
                and state.get("last_route_ok") is not False
                and (state["audio_out_bytes"] > 0 or text)
            ):
                state["successful_response"] = True
            if state.get("close_after_response"):
                audio_seconds = state["audio_out_bytes"] / 2 / max(1, args.realtime_sample_rate)
                drain_seconds = audio_seconds + max(0.0, args.realtime_playback_drain_extra_seconds)
                await asyncio.sleep(max(0.0, args.realtime_close_after_response_delay, drain_seconds))
                state["closing"] = True
                break
            continue

        if event_type == "error":
            stop_thinking_cue(state)
            error = event.get("error") or event
            if isinstance(error, dict) and error.get("code") == "response_cancel_not_active":
                log("Realtime error ignored", error=json.dumps(error)[:500])
                continue
            log("Realtime error", error=json.dumps(error)[:500])
            state["closing"] = True
            break


async def run_realtime_conversation(audio_queue, args, pre_roll, skip_initial_coherence=False):
    if websockets is None:
        raise RuntimeError("Python websockets package is not installed in the Jarvis wake venv")

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or api_key.startswith("replace-with-"):
        raise RuntimeError("OPENAI_API_KEY is not configured")

    session = await asyncio.to_thread(fetch_realtime_session_config, args)
    url = f"wss://api.openai.com/v1/realtime?model={args.realtime_model}"
    playback = start_pi_realtime_playback(args) if args.speech_output == "pi" else None
    state = {
        "closing": False,
        "response_active": False,
        "last_response_done": None,
        "last_event_at": time.monotonic(),
        "mute_until": 0.0,
        "audio_out_bytes": 0,
        "playback_lock": threading.Lock(),
        "thinking_cue_stop": None,
        "thinking_cue_thread": None,
        "handled_transcripts": set(),
        "direct_route_active": False,
        "direct_route_guard_until": 0.0,
        "last_direct_route_command": "",
        "last_user_transcript": "",
        "last_assistant_text": "",
        "last_assistant_text_at": 0.0,
        "close_after_response": False,
        "last_working_cue_at": 0.0,
        "wake_ack_sent": False,
        "conversation_established": False,
        "skip_initial_coherence": bool(skip_initial_coherence),
        "successful_response": False,
        "last_route_ok": None,
    }

    try:
        async with websockets.connect(
            url,
            subprotocols=["realtime", f"openai-insecure-api-key.{api_key}"],
            max_size=8_000_000,
        ) as ws:
            await send_realtime_event(ws, {"type": "session.update", "session": session})
            sender = asyncio.create_task(realtime_audio_sender(ws, audio_queue, args, state, pre_roll))
            receiver = asyncio.create_task(realtime_event_receiver(ws, args, state, playback))
            done, pending = await asyncio.wait(
                {sender, receiver},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                task.result()
            state["closing"] = True
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
    finally:
        stop_thinking_cue(state)
        if playback and state.get("audio_out_bytes", 0) > 0:
            audio_seconds = state["audio_out_bytes"] / 2 / max(1, args.realtime_sample_rate)
            finish_pcm_playback(
                playback,
                "Pi realtime speaker",
                timeout=max(3.0, audio_seconds + max(0.0, args.realtime_playback_drain_extra_seconds) + 1.0),
            )
        else:
            stop_process(playback, "Pi realtime speaker")
    return state


def capture_realtime_conversation(audio_queue, args, pre_roll=None, skip_initial_coherence=False):
    voice_light_cue(args, "listening")
    log(
        "Realtime conversation starting",
        pre_roll_chunks=len(pre_roll or []),
        skip_initial_coherence=bool(skip_initial_coherence),
    )
    state = asyncio.run(run_realtime_conversation(
        audio_queue,
        args,
        pre_roll or [],
        skip_initial_coherence=skip_initial_coherence,
    ))
    voice_light_restore(args)
    return state


def ha_call_service(domain, service, service_data):
    token = os.environ.get("HOMEASSISTANT_TOKEN", "")
    ha_url = os.environ.get("HOMEASSISTANT_URL", "http://192.168.1.55:8123").rstrip("/")
    if not token:
        raise RuntimeError("HOMEASSISTANT_TOKEN is not configured")

    response = requests.post(
        f"{ha_url}/api/services/{domain}/{service}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=service_data,
        timeout=20,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Home Assistant {domain}.{service} failed {response.status_code}: {response.text[:200]}")
    return response.json()


def ha_get_state(entity_id):
    token = os.environ.get("HOMEASSISTANT_TOKEN", "")
    ha_url = os.environ.get("HOMEASSISTANT_URL", "http://192.168.1.55:8123").rstrip("/")
    if not token:
        raise RuntimeError("HOMEASSISTANT_TOKEN is not configured")

    response = requests.get(
        f"{ha_url}/api/states/{entity_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Home Assistant state {entity_id} failed {response.status_code}: {response.text[:200]}")
    return response.json()


def speak_mac(text):
    if not text:
        return
    subprocess.Popen(["/usr/bin/say", text[:220]])


def speak_sonos(text, media_player, tts_entity, volume=None):
    if not text:
        return
    if volume is not None:
        ha_call_service(
            "media_player",
            "volume_set",
            {"entity_id": media_player, "volume_level": volume},
        )
    ha_call_service(
        "tts",
        "speak",
        {
            "entity_id": tts_entity,
            "media_player_entity_id": media_player,
            "message": text[:220],
            "cache": True,
        },
    )


def speak_pi_satellite(text, satellite_entity):
    if not text:
        return
    ha_call_service(
        "assist_satellite",
        "announce",
        {
            "entity_id": satellite_entity,
            "message": text[:220],
            "preannounce": False,
        },
    )


def set_sonos_volume(media_player, volume):
    if volume is None:
        return
    ha_call_service(
        "media_player",
        "volume_set",
        {"entity_id": media_player, "volume_level": volume},
    )


def get_sonos_volume(output, media_player):
    if output != "sonos":
        return None
    try:
        state = ha_get_state(media_player)
        volume = state.get("attributes", {}).get("volume_level")
        return float(volume) if volume is not None else None
    except Exception as error:
        log("Sonos original volume read failed", error=str(error))
        return None


def restore_sonos_volume(output, media_player, volume):
    if output != "sonos" or volume is None:
        return
    if volume == "__skip__":
        log("Sonos volume restore skipped; volume command handled")
        return
    try:
        set_sonos_volume(media_player, volume)
        log("Sonos volume restored", volume=round(volume, 2))
    except Exception as error:
        log("Sonos volume restore failed", error=str(error))


def action_service_name(action):
    service = action.get("service")
    domain = action.get("domain")
    if service:
        service = str(service)
        if "." in service or not domain:
            return service
        return f"{domain}.{service}"

    service_name = action.get("service_name")
    if domain and service_name:
        return f"{domain}.{service_name}"

    return ""


def action_entity_ids(action):
    service_data = action.get("service_data") or {}
    entity_id = service_data.get("entity_id")
    if isinstance(entity_id, list):
        return {str(item) for item in entity_id}
    if entity_id:
        return {str(entity_id)}
    return set()


def route_changes_sonos_volume(routed, media_player):
    return route_sonos_restore_volume(routed, media_player) is not None


def route_changes_lights(routed):
    if not isinstance(routed, dict):
        return False
    for action in routed.get("actions", []):
        if not isinstance(action, dict):
            continue
        if action_service_name(action).startswith("light."):
            return True
    return False


def route_sonos_restore_volume(routed, media_player):
    if not isinstance(routed, dict):
        return None

    for action in routed.get("actions", []):
        if not isinstance(action, dict):
            continue
        service = action_service_name(action)
        if service not in {
            "media_player.volume_set",
            "media_player.volume_up",
            "media_player.volume_down",
            "media_player.volume_mute",
        }:
            continue
        entities = action_entity_ids(action)
        if entities and media_player not in entities:
            continue
        if service == "media_player.volume_set":
            volume = (action.get("service_data") or {}).get("volume_level")
            try:
                volume = float(volume)
            except (TypeError, ValueError):
                return "__skip__"
            if 0 <= volume <= 1:
                return volume
        return "__skip__"

    return None


def speak(text, output, media_player, tts_entity, volume):
    load_env_file("/Users/santiarano/.hermes/jarvis-router.env", override=True)
    try:
        volume = float(os.environ.get("JARVIS_SPEECH_VOLUME", str(volume)))
    except ValueError:
        pass
    if output == "sonos":
        try:
            speak_sonos(text, media_player, tts_entity, volume)
            return
        except Exception as error:
            log("Sonos speech failed; falling back to Mac", error=str(error))
    if output == "pi":
        try:
            satellite = os.environ.get("JARVIS_PI_ASSIST_SATELLITE", "assist_satellite.assist_microphone")
            speak_pi_satellite(text, satellite)
            return
        except Exception as error:
            log("Pi satellite speech failed; falling back to Mac", error=str(error))
    speak_mac(text)


def duck_sonos_for_listening(output, media_player, volume):
    if output != "sonos":
        return
    load_env_file("/Users/santiarano/.hermes/jarvis-router.env", override=True)
    try:
        volume = float(os.environ.get("JARVIS_LISTENING_VOLUME", str(volume)))
    except ValueError:
        pass
    try:
        set_sonos_volume(media_player, volume)
        log("Sonos ducked for listening", volume=round(volume, 2))
    except Exception as error:
        log("Sonos duck failed", error=str(error))


def speech_wait_seconds(text):
    words = len(str(text or "").split())
    return max(1.4, min(6.0, 0.35 * words + 0.8))


def should_listen_for_followup(text):
    lowered = str(text or "").lower()
    if not lowered.strip():
        return False
    question_phrases = [
        "?",
        "which one",
        "which speaker",
        "which room",
        "what would you like",
        "would you like",
        "do you want",
        "is that what",
        "let me know",
        "clarify",
        "which",
        "que quieres",
        "cual",
        "cuál",
        "quieres que",
        "te gustaria",
        "te gustaría",
        "confirmas",
    ]
    return any(phrase in lowered for phrase in question_phrases)


def router_base_url(command_url):
    return command_url.rsplit("/", 1)[0]


def post_pi_connection_state(args, connected, announce=False, error=""):
    try:
        post_json(
            f"{router_base_url(args.command_url)}/pi-connection-state",
            {
                "connected": bool(connected),
                "announce": bool(announce),
                "host": args.pi_ssh_host,
                "user": args.pi_ssh_user,
                "source": "jarvis-wake",
                "error": str(error or ""),
            },
            timeout=2,
        )
        return True
    except Exception as exc:
        log("Pi connection state notify failed", connected=bool(connected), error=str(exc))
        return False


def voice_light_cue(args, mode):
    try:
        post_json(f"{router_base_url(args.command_url)}/voice-light-cue", {"mode": mode}, timeout=2)
    except Exception as error:
        log("Voice light cue failed", mode=mode, error=str(error))


def voice_light_restore(args):
    try:
        post_json(f"{router_base_url(args.command_url)}/voice-light-restore", {}, timeout=3)
    except Exception as error:
        log("Voice light restore failed", error=str(error))


def voice_light_clear(args):
    try:
        post_json(f"{router_base_url(args.command_url)}/voice-light-clear", {}, timeout=2)
    except Exception as error:
        log("Voice light clear failed", error=str(error))


def capture_route_and_speak(
    audio_queue,
    args,
    context=None,
    max_seconds=7.0,
    min_seconds=1.2,
):
    duck_sonos_for_listening(args.speech_output, args.speech_media_player, args.listening_volume)
    voice_light_cue(args, "listening")
    if os.environ.get("JARVIS_MIC_SOURCE", "mac").lower() == "pi":
        log("Audio queue preserved for Pi command capture")
    else:
        drained = drain_audio_queue(audio_queue)
        if drained:
            log("Audio queue drained before listening", chunks=drained)

    audio = record_command(
        audio_queue,
        args.samplerate,
        args.blocksize,
        max_seconds=max_seconds,
        min_seconds=min_seconds,
    )
    log("Command recorded", seconds=round(audio.size / args.samplerate, 2), level=round(rms(audio), 1))
    text = transcribe(audio, args.samplerate, args.transcription_model)
    log("Command transcribed", text=text)
    post_notify(args.notify_url, "transcript", {"text": text})

    if str(text or "").strip().lower().strip(".!?") in {
        "i didn't catch that",
        "sorry, i couldn't do that",
        "sorry i couldn't do that",
    }:
        log("Ignoring self-echo transcript", text=text)
        return None, ""

    if not accept_initial_transcript(args, text, context=context):
        log("Ignoring incoherent command transcript", gate=transcript_gate_label(text, context=context), text=text)
        play_error_chime(args)
        return None, ""

    route_text = text
    if context:
        route_text = f"{context}\nUser replied: {text}"

    voice_light_cue(args, "thinking")
    play_pi_working_cue_once(args)
    routed = route_command(args.command_url, route_text)
    restore_volume = route_sonos_restore_volume(routed, args.speech_media_player)
    if restore_volume is not None:
        routed["_sonos_restore_volume"] = restore_volume
        log("Sonos command volume captured", volume=routed["_sonos_restore_volume"])
    spoken = routed.get("spoken_response", "Done.")
    log(
        "Command routed",
        route=routed.get("route"),
        response=spoken,
        actions=len(routed.get("actions", [])),
    )
    post_notify(
        args.notify_url,
        "response",
        {
            "text": spoken,
            "route": routed.get("route"),
            "actions": len(routed.get("actions", [])),
        },
    )
    voice_light_cue(args, "speaking")
    speak(
        spoken,
        args.speech_output,
        args.speech_media_player,
        args.speech_tts_entity,
        args.speech_volume,
    )
    return routed, text


def main():
    load_env_file("/Users/santiarano/.hermes/jarvis-router.env")
    parser = argparse.ArgumentParser(description="Local Hey Jarvis wake-word listener.")
    parser.add_argument("--wake-url", default="http://127.0.0.1:8787/wake")
    parser.add_argument("--command-url", default="http://127.0.0.1:8787/command")
    parser.add_argument("--notify-url", default="http://127.0.0.1:8787/notify")
    parser.add_argument("--model", default="hey_jarvis")
    parser.add_argument("--transcription-model", default="gpt-4o-mini-transcribe")
    parser.add_argument("--speech-output", default=os.environ.get("JARVIS_SPEECH_OUTPUT", "sonos"), choices=["sonos", "pi", "mac"])
    parser.add_argument("--speech-media-player", default=os.environ.get("JARVIS_SPEECH_MEDIA_PLAYER", "media_player.sonos"))
    parser.add_argument("--speech-tts-entity", default=os.environ.get("JARVIS_SPEECH_TTS_ENTITY", "tts.google_translate_en_com"))
    parser.add_argument("--speech-volume", type=float, default=float(os.environ.get("JARVIS_SPEECH_VOLUME", "0.28")))
    parser.add_argument("--listening-volume", type=float, default=float(os.environ.get("JARVIS_LISTENING_VOLUME", "0.15")))
    parser.add_argument("--followup-turns", type=int, default=int(os.environ.get("JARVIS_FOLLOWUP_TURNS", "2")))
    parser.add_argument("--followup-max-seconds", type=float, default=float(os.environ.get("JARVIS_FOLLOWUP_MAX_SECONDS", "8.0")))
    parser.add_argument("--followup-wake-grace-seconds", type=float, default=float(os.environ.get("JARVIS_FOLLOWUP_WAKE_GRACE_SECONDS", "90.0")))
    parser.add_argument("--coherence-source", default=os.environ.get("JARVIS_COHERENCE_SOURCE", "hermes"))
    parser.add_argument("--coherence-timeout-seconds", type=float, default=float(os.environ.get("JARVIS_COHERENCE_TIMEOUT_SECONDS", "1.6")))
    parser.add_argument("--native-commands", default=os.environ.get("JARVIS_NATIVE_COMMANDS", "false"))
    parser.add_argument("--threshold", type=float, default=float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.82")))
    parser.add_argument("--cooldown", type=float, default=float(os.environ.get("JARVIS_WAKE_COOLDOWN", "8.0")))
    parser.add_argument("--startup-wake-suppression", type=float, default=float(os.environ.get("JARVIS_STARTUP_WAKE_SUPPRESSION", "6.0")))
    parser.add_argument("--post-response-wake-suppression", type=float, default=float(os.environ.get("JARVIS_POST_RESPONSE_WAKE_SUPPRESSION", "8.0")))
    parser.add_argument("--samplerate", type=int, default=16000)
    parser.add_argument("--blocksize", type=int, default=1280)
    parser.add_argument("--device", default=None)
    parser.add_argument("--realtime-model", default=os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-mini"))
    parser.add_argument("--realtime-voice", default=os.environ.get("OPENAI_REALTIME_VOICE", "marin"))
    parser.add_argument("--realtime-sample-rate", type=int, default=int(os.environ.get("JARVIS_REALTIME_SAMPLE_RATE", "24000")))
    parser.add_argument("--realtime-window-seconds", type=float, default=float(os.environ.get("JARVIS_REALTIME_WINDOW_SECONDS", "24.0")))
    parser.add_argument("--realtime-followup-window-seconds", type=float, default=float(os.environ.get("JARVIS_REALTIME_FOLLOWUP_WINDOW_SECONDS", "8.0")))
    parser.add_argument("--realtime-echo-guard-seconds", type=float, default=float(os.environ.get("JARVIS_REALTIME_ECHO_GUARD_SECONDS", "2.0")))
    parser.add_argument("--realtime-vad-threshold", type=float, default=float(os.environ.get("JARVIS_REALTIME_VAD_THRESHOLD", "0.5")))
    parser.add_argument("--realtime-vad-silence-ms", type=int, default=int(os.environ.get("JARVIS_REALTIME_VAD_SILENCE_MS", "450")))
    parser.add_argument("--realtime-preroll-seconds", type=float, default=float(os.environ.get("JARVIS_REALTIME_PREROLL_SECONDS", "1.2")))
    parser.add_argument("--realtime-close-after-response-delay", type=float, default=float(os.environ.get("JARVIS_REALTIME_CLOSE_AFTER_RESPONSE_DELAY", "0.65")))
    parser.add_argument("--realtime-playback-drain-extra-seconds", type=float, default=float(os.environ.get("JARVIS_REALTIME_PLAYBACK_DRAIN_EXTRA_SECONDS", "1.0")))
    parser.add_argument("--audio-cues", default=os.environ.get("JARVIS_AUDIO_CUES", "true"))
    parser.add_argument("--wake-chime-gain", type=float, default=float(os.environ.get("JARVIS_WAKE_CHIME_GAIN", "0.065")))
    parser.add_argument("--error-chime-gain", type=float, default=float(os.environ.get("JARVIS_ERROR_CHIME_GAIN", "0.035")))
    parser.add_argument("--thinking-cue-gain", type=float, default=float(os.environ.get("JARVIS_THINKING_CUE_GAIN", "0.014")))
    parser.add_argument("--working-cue-gain", type=float, default=float(os.environ.get("JARVIS_WORKING_CUE_GAIN", os.environ.get("JARVIS_THINKING_CUE_GAIN", "0.012"))))
    parser.add_argument("--working-cue-min-interval", type=float, default=float(os.environ.get("JARVIS_WORKING_CUE_MIN_INTERVAL", "1.5")))
    parser.add_argument("--wake-ack-text", default=os.environ.get("JARVIS_WAKE_ACK_TEXT", "Yes?"))
    parser.add_argument("--direct-route-guard-seconds", type=float, default=float(os.environ.get("JARVIS_DIRECT_ROUTE_GUARD_SECONDS", "8.0")))
    parser.add_argument("--allow-model-home-tools", default=os.environ.get("JARVIS_ALLOW_MODEL_HOME_TOOLS", "false"))
    parser.add_argument("--pi-ssh-host", default=os.environ.get("JARVIS_PI_SSH_HOST", "192.168.1.55"))
    parser.add_argument("--pi-ssh-user", default=os.environ.get("JARVIS_PI_SSH_USER", "santiarano"))
    parser.add_argument("--pi-ssh-key", default=os.environ.get("JARVIS_PI_SSH_KEY", "/Users/santiarano/.ssh/id_ed25519"))
    parser.add_argument("--pi-mic-gain", type=float, default=float(os.environ.get("JARVIS_PI_MIC_GAIN", "4.0")))
    args = parser.parse_args()

    audio_queue = queue.Queue()
    last_wake = 0.0
    last_successful_interaction_at = 0.0
    wake_suppressed_until = time.monotonic() + max(0.0, args.startup_wake_suppression)
    mic_source = os.environ.get("JARVIS_MIC_SOURCE", "mac").lower()
    native_command_mode = str(args.native_commands).strip().lower()
    realtime_commands_enabled = native_command_mode in {"realtime", "openai", "voice"}
    native_commands_enabled = native_command_mode in {"1", "true", "yes", "on"}
    pre_roll_chunks = deque(
        maxlen=max(1, int((args.realtime_preroll_seconds * args.samplerate) / args.blocksize))
    )
    download_models(model_names=[args.model])
    model = Model(wakeword_models=[args.model], inference_framework="tflite")

    def callback(indata, frames, callback_time, status):
        if status:
            log("Audio status", status=str(status))
        audio_queue.put(indata.copy())

    log(
        "Jarvis wake listener starting",
        model=args.model,
        threshold=args.threshold,
        wake_url=args.wake_url,
        native_commands=native_command_mode,
        speech_output=args.speech_output,
        mic_source=mic_source,
        realtime_model=args.realtime_model if realtime_commands_enabled else "",
        startup_suppression_seconds=args.startup_wake_suppression,
    )

    def process_audio_forever():
        nonlocal last_wake, last_successful_interaction_at, wake_suppressed_until
        last_score_log = 0.0
        best_score = 0.0
        log("Jarvis wake listener ready")

        def suppress_post_response_wake(reason):
            nonlocal wake_suppressed_until
            drained = drain_audio_queue(audio_queue)
            pre_roll_chunks.clear()
            seconds = max(0.0, args.post_response_wake_suppression)
            wake_suppressed_until = time.monotonic() + seconds
            log("Post-response wake suppression", reason=reason, seconds=round(seconds, 1), drained=drained)

        while True:
            audio = audio_queue.get()
            audio = np.asarray(audio).reshape(-1)
            pre_roll_chunks.append(audio.copy())
            now = time.monotonic()
            predictions = model.predict(audio)
            score = float(predictions.get(args.model, 0.0))
            best_score = max(best_score, score)
            if score >= 0.2 or now - last_score_log >= 10.0:
                log("Wake score", score=round(score, 3), best=round(best_score, 3), level=round(rms(audio), 1))
                last_score_log = now
                best_score = 0.0

            if score >= args.threshold and now - last_wake >= args.cooldown and now >= wake_suppressed_until:
                last_wake = now
                followup_wake = (
                    last_successful_interaction_at > 0.0
                    and now - last_successful_interaction_at <= max(0.0, args.followup_wake_grace_seconds)
                )
                log(
                    "Wake word detected",
                    score=round(score, 3),
                    followup_wake=followup_wake,
                    seconds_since_success=round(now - last_successful_interaction_at, 1)
                    if last_successful_interaction_at > 0.0
                    else None,
                )
                play_wake_chime(args)
                original_volume = get_sonos_volume(args.speech_output, args.speech_media_player)
                final_spoken = ""
                if native_commands_enabled:
                    post_notify(args.notify_url, "native-wake", {"native": True})
                elif realtime_commands_enabled:
                    try:
                        result = post_wake(args.wake_url)
                        log("Wake event sent", response=result[:200])
                    except Exception as error:
                        log("Wake event failed", error=str(error))
                else:
                    try:
                        result = post_wake(args.wake_url)
                        log("Wake event sent", response=result[:200])
                    except Exception as error:
                        log("Wake event failed", error=str(error))

                if realtime_commands_enabled:
                    try:
                        realtime_state = capture_realtime_conversation(
                            audio_queue,
                            args,
                            list(pre_roll_chunks),
                            skip_initial_coherence=followup_wake,
                        )
                        if realtime_state.get("successful_response"):
                            last_successful_interaction_at = time.monotonic()
                            log("Successful realtime interaction recorded")
                    except Exception as error:
                        log("Realtime command handling failed", error=str(error))
                        post_notify(args.notify_url, "wake-error", {"error": str(error)})
                        final_spoken = "Sorry, I couldn't start the realtime voice."
                        voice_light_cue(args, "speaking")
                        speak(final_spoken, args.speech_output, args.speech_media_player, args.speech_tts_entity, args.speech_volume)
                        time.sleep(speech_wait_seconds(final_spoken))
                        restore_sonos_volume(args.speech_output, args.speech_media_player, original_volume)
                        voice_light_restore(args)
                    suppress_post_response_wake("realtime_conversation")
                    last_wake = time.monotonic()
                    continue

                if not native_commands_enabled:
                    log("Native command handling skipped; laptop voice session owns conversation")
                    last_wake = time.monotonic()
                    continue

                try:
                    initial_context = "Recent Jarvis interaction; treat this as a follow-up." if followup_wake else None
                    routed, text = capture_route_and_speak(audio_queue, args, context=initial_context)
                    if not text:
                        restore_sonos_volume(args.speech_output, args.speech_media_player, original_volume)
                        voice_light_restore(args)
                        suppress_post_response_wake("ignored_transcript")
                        last_wake = time.monotonic()
                        continue

                    for followup_index in range(max(0, args.followup_turns)):
                        spoken = routed.get("spoken_response", "") if routed else ""
                        if not should_listen_for_followup(spoken):
                            break

                        wait_seconds = speech_wait_seconds(spoken)
                        log("Follow-up listening scheduled", turn=followup_index + 1, wait_seconds=round(wait_seconds, 2))
                        time.sleep(wait_seconds)
                        post_notify(
                            args.notify_url,
                            "response",
                            {
                                "text": "Listening for your reply...",
                                "route": "followup",
                                "actions": 0,
                            },
                        )
                        context = f'Jarvis just asked: "{spoken}"'
                        routed, followup_text = capture_route_and_speak(
                            audio_queue,
                            args,
                            context=context,
                            max_seconds=args.followup_max_seconds,
                            min_seconds=0.8,
                        )
                        if not followup_text:
                            log("Follow-up listening ended without speech")
                            break

                    final_spoken = routed.get("spoken_response", "") if routed else ""
                    if routed and routed.get("ok"):
                        last_successful_interaction_at = time.monotonic()
                        log("Successful native interaction recorded")
                    time.sleep(speech_wait_seconds(final_spoken))
                    restore_volume = routed.get("_sonos_restore_volume", original_volume) if routed else original_volume
                    restore_sonos_volume(args.speech_output, args.speech_media_player, restore_volume)
                    if route_changes_lights(routed):
                        voice_light_clear(args)
                    else:
                        voice_light_restore(args)
                    suppress_post_response_wake("native_conversation")
                    last_wake = time.monotonic()
                except Exception as error:
                    log("Command handling failed", error=str(error))
                    post_notify(args.notify_url, "wake-error", {"error": str(error)})
                    final_spoken = "Sorry, I couldn't do that."
                    voice_light_cue(args, "speaking")
                    speak(final_spoken, args.speech_output, args.speech_media_player, args.speech_tts_entity, args.speech_volume)
                    time.sleep(speech_wait_seconds(final_spoken))
                    restore_sonos_volume(args.speech_output, args.speech_media_player, original_volume)
                    voice_light_restore(args)
                    suppress_post_response_wake("error")

    if mic_source == "pi":
        stop_event = threading.Event()
        start_pi_audio_reader(audio_queue, args, stop_event)
        process_audio_forever()
    else:
        with sd.InputStream(
            samplerate=args.samplerate,
            channels=1,
            dtype="int16",
            blocksize=args.blocksize,
            device=args.device,
            callback=callback,
        ):
            process_audio_forever()


if __name__ == "__main__":
    main()
