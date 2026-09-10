#!/usr/bin/env bash
# Transkribiert neue Arztgespräche im Daten-Repo und committet die Texte zurück.
# Die App zeigt eine .txt-Datei, die neben einer Aufnahme liegt, als Transkript an.
#
#   ./tools/transkribieren.sh ~/krankenakte
#
# Läuft am besten auf workstation-0 (GPU). Modell/Sprache unten anpassbar.

set -euo pipefail

REPO="${1:-}"
MODEL="${MODEL:-large-v3}"
LANG="${LANG_CODE:-de}"
MIN_SPK="${MIN_SPK:-2}"
MAX_SPK="${MAX_SPK:-3}"

if [[ -z "$REPO" || ! -d "$REPO/.git" ]]; then
  echo "Nutzung: $0 <pfad-zum-daten-repo>" >&2
  exit 1
fi
command -v transcribe >/dev/null || { echo "transcribe nicht im PATH." >&2; exit 1; }

cd "$REPO"
git pull --ff-only --quiet || echo "Hinweis: pull übersprungen."

shopt -s nullglob globstar
new=0

for audio in dateien/**/*.{m4a,webm,ogg,mp3,wav}; do
  [[ -e "$audio" ]] || continue
  txt="${audio%.*}.txt"
  [[ -e "$txt" ]] && continue

  echo "→ ${audio}"
  # --diarize trennt Arzt und Patient; ohne Sprechertrennung wird der Text schnell unlesbar.
  if transcribe "$audio" -m "$MODEL" -l "$LANG" -f txt \
       --diarize --min-speakers "$MIN_SPK" --max-speakers "$MAX_SPK" -o "$txt"; then
    git add "$txt"
    new=$((new + 1))
  else
    echo "   fehlgeschlagen, übersprungen." >&2
    rm -f "$txt"
  fi
done

if (( new > 0 )); then
  git commit -qm "Transkripte: ${new} $([[ $new -eq 1 ]] && echo Aufnahme || echo Aufnahmen)"
  git push -q
  echo "${new} transkribiert und gepusht. Die App holt sie beim nächsten Sync."
else
  echo "Nichts Neues zu transkribieren."
fi
