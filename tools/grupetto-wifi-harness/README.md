# Grupetto Wi-Fi test harness

Standalone native SwiftUI macOS app (macOS 13+). No connection to the workout player, recording or Strava. No third-party dependencies. It uses Network.framework for Bonjour and TCP.

## Build and launch

With Xcode or Swift command-line tools installed, from the repository root:

```sh
sh tools/grupetto-wifi-harness/build.sh
open "tools/grupetto-wifi-harness/dist/Grupetto WiFi Test.app"
```

The build creates a locally ad-hoc-signed `.app` in `dist/`. Copy it to Applications if desired. The default build targets the current Mac architecture; this is not a notarized distribution or a universal binary.

## Test with the bike

1. Run a Grupetto version supporting DirCon, and enable its Wi-Fi/DirCon broadcast. Leave Grupetto running.
2. Connect the Mac and Peloton to the same local network. The Mac can use Ethernet. Guest/client isolation must be off.
3. Launch the app and allow Local Network access if macOS asks.
4. Discovery and connection start automatically. The first time, the app selects a service whose name contains Grupetto; subsequent launches remember that service name. Other DirCon trainers are not selected automatically. If multiple Grupetto bikes are present, the first name in sorted order is selected on initial setup.
5. Only if initial discovery finds no matching bike after eight seconds, a connection sheet appears while scanning continues. You can dismiss it and keep looking, select a listed device, or enter the Peloton's IP address and port **8081**, then click **Connect address**. Discovery uses the advertised port; manual port is editable for other builds.
6. Pedal and vary cadence/resistance. Check that the displayed values follow Grupetto. Heart rate requires a connected sensor and supported relay.
7. Click **Disconnect** when finished. Use **Copy log** to capture diagnostics if it fails.

The app waits indefinitely for metrics; an idle bike does not cause an application timeout. Disconnect manually to stop waiting. Socket errors, peer closure or invalid framing trigger silent reconnection indefinitely with retry delays of 1, 2, 4, then at most 5 seconds. Malformed measurement payloads are dropped without disconnecting. No recovery alerts, sounds or prompts appear. The initial no-bike sheet is never shown during recovery. Each field becomes stale after five seconds without its own update; unavailable fields stay blank. After Indoor Bike Data arrives, fields absent from that packet are labeled **Not in bike packet**, with a decoded field summary in the log. Distance, energy and bike elapsed are optional; Grupetto builds that broadcast only speed/cadence/resistance/power will omit them. The harness does not invent accumulated values. Disconnect retains the last readings marked stale. Automatic recovery preserves the last readings and their stale timestamps until fresh samples arrive. Explicitly selecting a device clears them. Packet logs are bounded to 500 lines and held only in memory.

## Display smoothing

**Power average** defaults to 3 seconds and is saved across launches. The old 30-second default migrates to 3 seconds once; other custom values are retained. Set it from 0–300 seconds; 0 displays raw readings. The power card shows **Current power** (raw watts) and a separate labeled rolling average (3s by default). Only power is smoothed. Cadence, heart rate, speed and resistance show current readings; distance, energy and bike elapsed remain cumulative/raw. Turning averaging off hides the averaged value.

The trailing mean is weighted by elapsed time rather than packet count. Startup averages the available history without padding with zeros. A telemetry gap longer than five seconds starts fresh for that metric; reconnects clear averaging history while preserving stale raw readings. Freshness labels use raw arrival times, never the average. Speed unit conversion applies directly to current raw speed. Changing the window immediately recalculates from up to five minutes of retained history.

Raw decoded metrics and packet logs remain unchanged. This harness still does not record/export FIT files. Future FIT recording should use unsmoothed, timestamped measurements, keeping display smoothing separate.

## Protocol and limits

- Browse `_wahoo-fitness-tnp._tcp` via Bonjour.
- TCP service discovery → characteristic discovery → notifications for FTMS Indoor Bike Data (0x2AD2), Cycling Power Measurement (0x2A63), Heart Rate Measurement (0x2A37).
- Parse FTMS speed, cadence, distance, resistance (Grupetto whole levels, 0–100), instantaneous power, energy, heart rate and elapsed time when present. Cycling Power fallback currently decodes watts only, not crank-event cadence. CSC-only cadence/speed is not decoded.
- Framing buffers split/coalesced TCP reads and rejects malformed headers/payloads. No characteristic writes or control-point requests are sent.
- Speed units can be selected as km/h or mph in the main window; the preference persists across launches and updates existing readings immediately. Raw speed stays in km/h. Resistance displays whole Peloton levels from 0–100, matching Grupetto telemetry (distinct from FTMS resistance control command scaling).
- Reads available measurements without estimating missing distance.
- DirCon service-discovery probes every ten seconds distinguish a quiet bike from an unresponsive protocol connection. If no protocol traffic arrives for 35 seconds, the app reconnects silently. A pending transport/handshake is retried after 15 seconds; this is not a metric timeout.
- Discovery stays active and restarts after browser failures. Bonjour service names are remembered, not resolved IP addresses, so each reconnection resolves the current address. Manually entered addresses are also remembered but remain fixed.
- Explicit Disconnect stops discovery and all retries. Resume automatic connection restarts them. macOS may still require its initial Local Network permission; the application cannot grant that permission itself.

Implementation references:

- [Grupetto DirCon server](https://github.com/doudar/grupetto/blob/develop/app/src/main/java/com/spop/poverlay/dircon/DirConServer.kt)
- [Grupetto constants, including TCP port 8081](https://github.com/doudar/grupetto/blob/develop/app/src/main/java/com/spop/poverlay/dircon/DirConConstants.kt)
- [DirCon protocol reference](https://github.com/elfrances/wahoo-fitness-tnp)

## Verification

```sh
swift test --package-path tools/grupetto-wifi-harness
```

Tests cover split/coalesced framing, invalid protocol versions, truncated metrics, absent fields, FTMS scaling/optional field offsets, signed power and 16-bit heart rate. A loopback TCP integration test additionally verifies more than 15 seconds without metrics, malformed-measurement tolerance, automatic reconnection/re-subscription, resumed metrics, no recovery dialog and explicit stop. Tests do not establish compatibility with an actual bike. Real-network discovery, permissions and installed Grupetto behavior require the hardware test above.
