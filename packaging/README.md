# Native installers

The desktop app bundles Electron (Chromium + Node) and the workout server. Riders do not install Node.js. The launcher opens the workout screen in their usual browser, displays the computer's LAN URLs, and keeps the server running. Browser-based OAuth stays in one browser, preserving its state cookie.

## Outputs and platform support

| OS | Native package | Architectures configured | Live Grupetto telemetry |
| --- | --- | --- | --- |
| macOS 13+ | Apple `.pkg` installer | arm64, x64 | Prebuilt Swift helper included |
| Windows | Windows Installer `.msi` | x64 | Not yet implemented |
| Linux | Debian `.deb`, RPM `.rpm` | x64 | Not yet implemented |

Windows/Linux packages support the workout browser, profile integration, recording storage and Strava uploads; they do not acquire live bike data yet. Porting the existing native DirCon client is separate work. Linux requires a graphical desktop supported by Electron; this package is not a headless service installer.

Local verification so far: Apple Silicon macOS package built, exact installer payload expanded and verified, app launched, browser opened all seven workouts, app quit cleanly. Windows/Linux and Intel Mac installer configurations need builds and installation checks on their respective target systems. No automatic updater, system service, or login startup is installed.

## Build

Use Node.js 24 LTS and `npm ci`. Build each installer on its matching OS:

```sh
npm run package:mac
npm run package:mac -- --arch x64
npm run package:windows
npm run package:linux
```

Mac build machines need Xcode/Swift tools; end users do not. Linux builders need `rpm` plus electron-builder's normal packaging prerequisites. Windows MSI builds use WiX downloaded by electron-builder. The manual/tag GitHub workflow builds each platform on an OS-matched runner and uploads the artifacts, without publishing a release or using Strava credentials.

Artifacts and SHA-256 files are written to `dist/`. The build stages an explicit allowlist in a temporary directory; this supports checkout paths containing spaces, `&`, and iCloud locations. Native tools never read private `.env` or `.data` from that staged project. The archive check also rejects private files and checks the local configured secret is absent from package contents.

`--dir` additionally copies an unpacked build into `dist/unpacked/`. Prefer testing/distributing the `.pkg` on a Mac: iCloud may attach Finder metadata to loose `.app` bundles and invalidate local signature checks. The package payload remains unchanged. Verify an extracted payload with `codesign --verify --deep --strict`.

## Install and use

On Mac, open the `.pkg`, install into Applications, and launch PelotonicReaction. Choose **Open workout screen**. Keep the app running while the bike uses the displayed LAN URL. Closing the Mac window keeps the server alive; Quit stops it and saves an active recording as interrupted. Other desktop platforms quit when their window closes.

The server binds port 8080 on the private LAN. It does not change firewall rules. If 8080 is occupied by the command-line app, stop that server first; the launcher never silently adopts another process. OS local-network/firewall prompts may still require initial user action. Strava uses `localhost:8080` unless its redirect setting is explicitly changed.

The launcher has sandboxed, isolated renderer code and a small IPC surface; it only opens the fixed local workout URL or the app's data folder. Workout pages run in the external browser.

## Persistent data and migration

Use **Open data folder** to find the authoritative location:

- Mac: `~/Library/Application Support/PelotonicReaction`
- Windows: `%APPDATA%/PelotonicReaction`
- Linux: Electron's user-data directory, normally `~/.config/PelotonicReaction`

This contains `workouts/`, optional `.env`, and `.data/` (tokens and ride files). Initial workouts and `.env.example` are copied there on first use. Existing files are never overwritten, including during upgrades. Newly added bundled workouts are seeded if absent; edited catalog files remain yours. Browser-local rider preferences remain in that browser's storage at the same localhost/LAN origin.

For an existing checkout, quit both versions and copy its `.env` and `.data` into the new data folder; optionally copy customized workouts into `workouts/`. Keep the same directory structure. The installer never embeds or automatically imports your credentials. If the client secret was committed, rotate it before migrating. Otherwise create `.env` from `.env.example`, enter your credentials, restart, and reconnect Strava.

Uninstalling the application leaves user data in place. Delete that folder yourself only when you intend to remove the profiles, tokens and recordings. Back it up first when migrating machines. Developers can use `PELOTONIC_DATA_DIR` and `PELOTONIC_PORT` to isolate a test launch; a different port requires matching OAuth configuration.

## Signing and release

Default local Mac builds use ad-hoc app signatures and an unsigned `.pkg`. They are test artifacts, not a notarized public release. Do not bypass OS security warnings automatically. For distribution, provide Apple Developer ID Application and Developer ID Installer certificates plus notarization credentials, set `PELOTONIC_SIGNED_RELEASE=1`, and follow [electron-builder signing configuration](https://www.electron.build/code-signing.html). Sign Windows installers with an appropriate Authenticode identity before distribution. Signing credentials belong in release secrets, never source files or packaged resources.

`npm audit --omit=dev` currently reports no runtime dependency vulnerabilities. The installed electron-builder toolchain has moderate transitive minimatch denial-of-service advisories; those build tools are not shipped. Review toolchain updates before public release.
