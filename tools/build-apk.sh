#!/usr/bin/env bash
# Builds the Android app: the web app bundled into a WebView wrapper.
#
#   tools/build-apk.sh            # writes android/build/apparatus.apk
#
# Needs: java/javac, node, curl, aapt, zipalign, apksigner, dalvik-exchange
# and an android.jar. On Ubuntu:
#   apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
#
# Signing: an update only installs over the existing app if it is signed with
# the same key. Keep the keystore somewhere safe and point APPARATUS_KEYSTORE
# at it; it defaults to android/apparatus.keystore (gitignored). If none
# exists a new one is created, and anything signed with the old key has to be
# uninstalled first, which wipes its data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android"
OUT="$SRC/build"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
KEYSTORE="${APPARATUS_KEYSTORE:-$SRC/apparatus.keystore}"
KEYPASS="${APPARATUS_KEYPASS:-apparatus}"

# Each build must have a higher version code than the last one installed.
VERSION_CODE="${VERSION_CODE:-$(( $(date -u +%s) / 60 ))}"
VERSION_NAME="${VERSION_NAME:-$(date -u +%Y.%m.%d)-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)}"

mkdir -p "$OUT"
rm -rf "$OUT/assets" "$OUT/res" "$OUT/classes" "$OUT/dex"
mkdir -p "$OUT/assets" "$OUT/res/mipmap-xxxhdpi" "$OUT/classes" "$OUT/dex"

# Web app, with its bundled fonts, so icons work with no network.
node "$ROOT/tools/bundle-web.js" "$ROOT" "$OUT/assets"

cp -r "$SRC/res/." "$OUT/res/"
cp "$ROOT/icon-192.png" "$OUT/res/mipmap-xxxhdpi/ic_launcher.png"

# Java 8 bytecode with no lambdas: that is what dalvik-exchange can convert.
find "$SRC/src" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
  -d "$OUT/classes" @"$OUT/sources.txt"
dalvik-exchange --dex --output="$OUT/dex/classes.dex" "$OUT/classes"

aapt package -f -M "$SRC/AndroidManifest.xml" -S "$OUT/res" -A "$OUT/assets" -I "$ANDROID_JAR" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -F "$OUT/unaligned.apk"
(cd "$OUT/dex" && aapt add "$OUT/unaligned.apk" classes.dex >/dev/null)
zipalign -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "No keystore at $KEYSTORE - creating a new signing key."
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYPASS" -keypass "$KEYPASS" \
    -alias apparatus -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Apparatus" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --out "$OUT/apparatus.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/apparatus.apk"
rm -f "$OUT/unaligned.apk" "$OUT/aligned.apk" "$OUT/apparatus.apk.idsig"

echo "Built $OUT/apparatus.apk  ($VERSION_NAME, code $VERSION_CODE)"
