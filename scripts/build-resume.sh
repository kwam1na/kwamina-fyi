#!/bin/sh
# Renders docs/resume.docx to public/docs/resume.pdf, the file the site serves.
# Uses Pages, the renderer available on this machine; scripts/build-resume-docx.mjs
# documents the import quirks the .docx is laid out around.
#
# Deliberately does not regenerate the .docx first. Chaining the two would make
# this command silently discard any edit made in Word or Pages, so rebuilding
# from source stays an explicit `bun run resume:docx`.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
source="$root/docs/resume.docx"
output="$root/public/docs/resume.pdf"

[ -f "$source" ] || { echo "build-resume: missing $source" >&2; exit 1; }

osascript <<EOF
set src to POSIX file "$source"
set dst to POSIX file "$output"
tell application "Pages"
  set d to open src
  export d to dst as PDF
  close d saving no
  quit
end tell
EOF

node "$root/scripts/set-pdf-title.mjs" "$output" "Resume — Kwamina Essuah Mensah"

echo "build-resume: wrote $output — open it and confirm it is still one page"
