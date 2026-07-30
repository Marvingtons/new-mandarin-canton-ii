#!/usr/bin/env bash
#
# Prove a print job arrives byte-identical, on the wire, with no encoding.
#
#   scripts/verify-job-wire.sh <url> [expected-sha256]
#
# Examples:
#   # local, no database needed — proves the app layer only
#   scripts/verify-job-wire.sh 'http://127.0.0.1:8787/api/ticket/preview?format=starprnt'
#
#   # deployed job route — the one that also proves Cloudflare's edge
#   scripts/verify-job-wire.sh 'https://<host>/api/print/<secret>?type=application/vnd.star.starprnt&mac=00:11:62:aa:bb:cc' \
#       3f5a...   # the sha256= value from the server log for that render
#
# WHY curl AND NOT A TEST. The failure being chased is 520 Download failed:
# the printer never got the bytes, so nothing inside the app can prove the
# fix. What has to be shown is what leaves Cloudflare — and only a real client
# asking for compression can show that. So the request deliberately sends
# `Accept-Encoding: gzip, br`, which is the invitation an intermediary needs
# to compress, and then checks it was declined.
#
# --compressed is deliberately NOT used: it would transparently decode any
# encoding and hide exactly the problem this exists to catch.
set -uo pipefail

URL="${1:?usage: verify-job-wire.sh <url> [expected-sha256]}"
EXPECTED="${2:-}"

BODY="$(mktemp)"; HEAD="$(mktemp)"
trap 'rm -f "$BODY" "$HEAD"' EXIT

# -L so a redirect is followed the way a client would; the header dump then
# holds every hop and the checks below read the FINAL one. --http1.1 so
# Transfer-Encoding is visible at all: HTTP/2 has no chunked framing to see,
# and chunked-without-length is one of the things being ruled out.
curl -sS --http1.1 -L \
  -H 'Accept-Encoding: gzip, br' \
  -D "$HEAD" -o "$BODY" \
  --max-time 60 \
  "$URL" || { echo "FAIL: request failed"; exit 1; }

hops="$(grep -ci '^HTTP/' "$HEAD" || true)"
status="$(awk 'BEGIN{IGNORECASE=1} /^HTTP\//{code=$2} END{print code}' "$HEAD")"
tenc="$(awk 'BEGIN{IGNORECASE=1} /^transfer-encoding:/{sub(/^[^:]*:[ \t]*/,""); gsub(/\r/,""); v=$0} END{print v}' "$HEAD")"
ctype="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/{sub(/^[^:]*:[ \t]*/,""); gsub(/\r/,""); v=$0} END{print v}' "$HEAD")"
clen="$(awk 'BEGIN{IGNORECASE=1} /^content-length:/{sub(/^[^:]*:[ \t]*/,""); gsub(/\r/,""); v=$0} END{print v}' "$HEAD")"
cenc="$(awk 'BEGIN{IGNORECASE=1} /^content-encoding:/{sub(/^[^:]*:[ \t]*/,""); gsub(/\r/,""); v=$0} END{print v}' "$HEAD")"
ccont="$(awk 'BEGIN{IGNORECASE=1} /^cache-control:/{sub(/^[^:]*:[ \t]*/,""); gsub(/\r/,""); v=$0} END{print v}' "$HEAD")"
actual_bytes="$(wc -c < "$BODY" | tr -d ' ')"
actual_sha="$(sha256sum "$BODY" | cut -d' ' -f1)"

echo "url             $URL"
echo "hops            $hops (1 = no redirect)"
echo "status          $status"
echo "content-type    ${ctype:-(absent)}"
echo "content-length  ${clen:-(absent)}"
echo "content-encoding ${cenc:-(absent)}"
echo "transfer-encoding ${tenc:-(absent)}"
echo "cache-control   ${ccont:-(absent)}"
echo "bytes received  $actual_bytes"
echo "sha256          $actual_sha"
[ -n "$EXPECTED" ] && echo "sha256 expected $EXPECTED"

fail=0
note() { echo "  FAIL: $*"; fail=1; }

[ "$status" = "200" ] || note "status $status, expected 200"
# The header the printer cannot handle. Its ABSENCE is the whole point.
[ -z "$cenc" ] || note "content-encoding is '$cenc' — the firmware cannot decode it"
[ -n "$clen" ] || note "no content-length; the printer is downloading blind"
# Chunked and Content-Length are mutually exclusive, and chunked is what the
# Worker response path was doing when the printer answered 520.
case "$tenc" in *chunked*) note "transfer-encoding is chunked; no fixed length to download";; esac
[ -n "$clen" ] && [ "$clen" != "$actual_bytes" ] &&
  note "content-length $clen but $actual_bytes bytes arrived"
case "$ccont" in *no-transform*) ;; *) note "cache-control lacks no-transform ('$ccont')";; esac
[ "$actual_bytes" -gt 0 ] || note "empty body"
if [ -n "$EXPECTED" ] && [ "$actual_sha" != "$EXPECTED" ]; then
  note "body hash differs from what the server rendered — it was altered in transit"
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: byte-exact, uncompressed, length declared"
else
  echo "FAILED"
fi
exit "$fail"
