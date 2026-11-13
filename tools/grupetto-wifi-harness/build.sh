#!/bin/sh
set -eu
cd "$(dirname "$0")"
swift build -c release
APP="$PWD/dist/Grupetto WiFi Test.app"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/GrupettoWiFi "$APP/Contents/MacOS/GrupettoWiFi"
cp Info.plist "$APP/Contents/Info.plist"
# iCloud/Finder may attach metadata that codesign rejects. Clear only generated bundle attributes.
xattr -cr "$APP"
codesign --force --sign - "$APP"
printf '\nBuilt: %s\n' "$APP"
