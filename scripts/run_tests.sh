#!/bin/zsh
# All checks: scripts/run_tests.sh <playwright-core path> <pdfjs-dist/legacy/build/pdf.js path>
#   npm install playwright-core@1.47 pdfjs-dist@3.11.174   (Chrome must be installed; set CHROME_PATH if not in /Applications)
set -e
set -o pipefail  # a failing test piped to tail must still stop the run
cd "${0:A:h}/.."
PW="$1"; PDFJS="$2"
python3 scripts/build.py
node tests/engine.test.js | tail -1
node tests/engine-v3.test.js | tail -1
node tests/opinion.test.js | tail -1
node tests/readers.test.js "$PDFJS" 2>/dev/null | grep -E '^SKIP|passed$'  # SKIP: HWP-only checks until the .hwp fixture exists
node tests/word-zip.test.js | tail -1
for t in v3-flow v3-ui opinion-flow extension-flow tab-switch file-switch v3-word-amend browser optional-fields preview-contacts word-import; do
  node tests/$t.test.js "$PW" > build/test-$t.log 2>&1 || {echo "FAIL $t (build/test-$t.log)"; tail -20 build/test-$t.log; exit 1}
  echo "PASS $t: $(grep -c '^PASS' build/test-$t.log) checks"
done
python3 scripts/verify_docx.py | tail -1
python3 scripts/verify_imported_docx.py | tail -1
