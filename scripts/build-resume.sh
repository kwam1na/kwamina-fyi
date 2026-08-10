#!/bin/sh
# Renders docs/resume.docx (the editable resume source) to public/docs/resume.pdf,
# the file the site serves. Uses Pages, the renderer available on this machine —
# its docx import drops tab stops and paragraph borders, which is why the source
# lays out title/date rows and heading rules as tables.
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

echo "build-resume: wrote $output — open it and confirm it is still one page"
