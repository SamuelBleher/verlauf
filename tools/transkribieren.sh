#!/usr/bin/env bash
# Transkribiert neue Aufnahmen im Daten-Repo und committet die Texte zurück.
# Die App zeigt eine .txt-Datei neben einer Aufnahme als Transkript an.
#
#   ./tools/transkribieren.sh ~/krankenakte
#
# Alles läuft lokal — es wird nichts hochgeladen.
#
# Stellschrauben:
#   MODEL=small            schneller, etwas ungenauer (Vorgabe: large-v3-turbo)
#   DIARIZE=0              ohne Sprechertrennung, rund viermal schneller
#   PUSH=0                 nur lokal committen, nicht pushen
#   LANG_CODE=en           Sprache erzwingen (Vorgabe: de)
#
# Tempo auf einem 8-Kern-Laptop, gemessen:
#   ohne Sprechertrennung  ~4x Echtzeit   (20-Minuten-Termin ≈ 5 min)
#   mit  Sprechertrennung  ~1,2x Echtzeit (20-Minuten-Termin ≈ 17 min)

set -euo pipefail

REPO="${1:-}"
MODEL="${MODEL:-large-v3-turbo}"
LANG_CODE="${LANG_CODE:-de}"
DIARIZE="${DIARIZE:-1}"
PUSH="${PUSH:-1}"
MIN_SPK="${MIN_SPK:-1}"
MAX_SPK="${MAX_SPK:-3}"

TRANSCRIBE="${TRANSCRIBE:-$HOME/.local/bin/transcribe}"
VENV_PY="${VENV_PY:-$HOME/tools/transcribe/.venv/bin/python}"
TO_WAV="$(cd "$(dirname "$0")" && pwd)/zu-wav.py"

[[ -n "$REPO" && -d "$REPO/.git" ]] || { echo "Nutzung: $0 <pfad-zum-daten-repo>" >&2; exit 1; }
[[ -x "$TRANSCRIBE" ]] || { echo "transcribe nicht gefunden: $TRANSCRIBE" >&2; exit 1; }
[[ -x "$VENV_PY" ]] || { echo "Python-Umgebung nicht gefunden: $VENV_PY" >&2; exit 1; }

cd "$REPO"
HAS_REMOTE=0
git remote get-url origin >/dev/null 2>&1 && HAS_REMOTE=1
[[ $HAS_REMOTE -eq 1 ]] && git pull --ff-only --quiet 2>/dev/null || true

shopt -s nullglob globstar
new=0 failed=0

for audio in dateien/**/*.{webm,m4a,ogg,mp3,wav,aac,opus}; do
  [[ -e "$audio" ]] || continue
  txt="${audio%.*}.txt"
  [[ -e "$txt" ]] && continue

  echo "→ ${audio}"

  # Immer erst nach WAV: pyannote bricht auf komprimierten Containern ab
  # (bei .webm mit einem TypeError, bei .ogg mit falscher Sample-Zahl).
  tmp="$(mktemp --suffix=.wav)"
  if ! "$VENV_PY" "$TO_WAV" "$audio" "$tmp" >/dev/null 2>&1; then
    echo "   Umwandlung fehlgeschlagen, übersprungen." >&2
    rm -f "$tmp"; failed=$((failed + 1)); continue
  fi

  args=(-m "$MODEL" -l "$LANG_CODE" -f txt -o "$txt")
  [[ "$DIARIZE" == "1" ]] && args+=(--diarize --min-speakers "$MIN_SPK" --max-speakers "$MAX_SPK")

  if "$TRANSCRIBE" "$tmp" "${args[@]}"; then
    rm -f "$tmp" "${tmp}.diar.json"
    git add "$txt"
    new=$((new + 1))
  else
    echo "   Transkription fehlgeschlagen, übersprungen." >&2
    rm -f "$txt" "$tmp" "${tmp}.diar.json"
    failed=$((failed + 1))
  fi
done

if (( new > 0 )); then
  if (( new == 1 )); then wort="Aufnahme"; else wort="Aufnahmen"; fi
  git commit -qm "Transkripte: ${new} ${wort}"
  if [[ $HAS_REMOTE -eq 1 && "$PUSH" == "1" ]]; then
    git push -q && echo "${new} transkribiert und gepusht. Die App holt sie beim nächsten Sync."
  else
    echo "${new} transkribiert und lokal committet."
  fi
else
  echo "Nichts Neues zu transkribieren."
fi
(( failed > 0 )) && echo "${failed} übersprungen." >&2
exit 0
