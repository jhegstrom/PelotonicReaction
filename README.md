# PelotonicReaction

A local cycling workout player for the view from your bike: large countdown, cadence, resistance and estimated watts; a preview of the next block; and an easy-to-follow workout profile.

## Run on Windows, macOS or Linux

Install **Node.js 18 or newer** (a current LTS release is recommended). The workout player has no npm dependencies. Live Grupetto telemetry currently requires a Mac host with Xcode or Swift command-line tools installed; the Peloton browser only needs access to that Mac on the LAN.

From the repository folder:

```sh
npm start
```

Open **http://localhost:8080** in a modern browser. Keep that terminal open while using the app. Stop it with Ctrl+C.

To use another port:

```sh
npm start -- --port 8090
```

To serve a tablet or another computer on the same private network:

```sh
npm start -- --host 0.0.0.0
```

On the other device, open `http://YOUR-COMPUTER-LAN-IP:8080`. Allow the server through your firewall on your private network if prompted. The workout catalog is read-only. The server also exposes live bike session controls and telemetry without a login; only share it on a trusted network. Do not expose it to the public internet. LAN clients share the catalog, while each browser runs its own timer. One browser screen at a time owns the shared live bike connection.

## Ride

1. Open a workout to inspect the targets and schedule.
2. Try **One-minute sound check** first; enable **Sound cues** and optionally **Spoken cues**.
3. Press **Start workout**. A 10-second countdown gives you time to get ready before the first block begins. You can pause and resume the countdown; it does not count toward ride time. A short tone sounds at 3, 2 and 1 seconds remaining and a longer tone marks each new block.
4. Pause/resume any time. Previous, next and schedule/profile clicks let you move between blocks. A running ride pauses for confirmation before jumping.
5. On landscape screens at least 1100 × 560 browser pixels, timers, live metrics and program blocks sit side by side. Narrower landscape tablets keep timers and live metrics side by side with program blocks below. The timer dashboard reserves the bottom 10% of the viewport for the Grupetto overlay. The block list follows the current interval automatically; you can also scroll that list independently to inspect other blocks. Smaller screens retain the stacked layout. Fullscreen enlarges the display. `Space` starts/pauses when the page has focus; arrow keys change blocks; `F` toggles fullscreen. Focused buttons keep their normal Space behavior.

The clock uses elapsed wall time, so delayed browser callbacks don't stretch an interval. If a tab was suspended, it catches up to the current block without replaying all missed cues. Keep the browser visible for dependable audio; browsers and operating systems can silence background tabs or sleeping devices. Speech depends on browser/device voice availability. The app requests a screen wake lock where supported (usually localhost or HTTPS); for plain HTTP over a LAN, disable automatic device sleep manually if needed.

## Portable rider profile and heart-rate zones

**Rider · Profile** opens the profile editor from the library or workout screen. The initial profile uses age 64 and the requested estimate `220 − 64 = 156 BPM`. Five zones use 50–60%, 60–70%, 70–80%, 80–90% and 90–100% of that estimate. Integer lower boundaries are rounded up; each upper boundary is one BPM below the next zone, so zones do not overlap:

| Zone | Initial range |
| --- | --- |
| 1 · Very light | 78–93 BPM |
| 2 · Light | 94–109 BPM |
| 3 · Moderate | 110–124 BPM |
| 4 · Hard | 125–140 BPM |
| 5 · Maximum | 141–156 BPM |

The HR card displays both BPM and profile zone together, without a selector. The saved profile preference determines which reading is larger. Readings outside the configured range show **Below Z1** or **Above Z5**, rather than being clamped to a zone. Missing telemetry displays a dash; stale readings remain visible, marked as last readings.

The versioned JSON profile is saved under `pelotonic-reaction-rider-profile-v1` in this browser’s localStorage. It includes a stable profile ID, name, age, max-HR method/value, explicit zone boundaries, and preferences for HR display, speed units and power averaging. Initial data is also available in `public/rider-profile.default.json`. **Export saved profile** downloads a portable JSON copy; **Import JSON** loads a draft for review, and Save applies it. Cancel discards drafts. Profiles do not yet synchronize automatically across browsers or through the server. Export before clearing browser storage or moving devices.

To change age, use **Recalculate from 220 − age** before saving. Entering a different maximum regenerates the five percentage zones and marks the maximum as manual. Custom contiguous boundaries can be edited in exported JSON and imported; malformed or incompatible profiles are rejected. The file format can support a richer profile editor without changing workout files.

These are initial age-based estimates, not measured physiological thresholds. References: [American Heart Association maximum-HR estimate](https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates/), [Polar five-zone percentage model](https://www.polar.com/en/guide/heart-rate-zones/).

## Live Grupetto metrics (Mac host)

Enable Grupetto’s Wi-Fi/DirCon broadcast on the bike. Start the server on the Mac with `npm start -- --host 0.0.0.0`, then open its LAN address on the Peloton browser. The browser does not pair over Bluetooth or require HTTPS for telemetry; the Mac performs Bonjour discovery and DirCon communication.

For the first run, prepare the native helper before riding:

```sh
npm run prepare:bike
```

The server also builds the helper automatically on the first ride. The helper uses the standalone harness’s tested native connection code in headless mode, including discovery, automatic re-subscription, silent retries, and idle-metric tolerance. macOS may request initial Local Network access. Stop the standalone harness while testing the main app so there is only one intended recorder/client.

Pressing Start initiates the bike connection during the 10-second preparation countdown. Pausing keeps it connected. Completion, returning to Workouts, or confirming Restart disconnects it; the next Start connects again. The workout timer continues if telemetry is unavailable, and last readings become muted and labeled as stale after five seconds without data. A connection sheet appears only if initial discovery finds no bike; recovery never displays it. The server silently retries a failed native helper as well as relying on its internal network recovery. The session remains reserved through browser/network interruptions; if a browser is gone for 90 seconds it is released.

**Ride data** places **Cadence → Output → Resistance** across the main row, with speed, HR, distance and calories below:

- Speed, with the average over the active workout; speed units come from Rider Profile.
- Current cadence, with the active-workout average, and current resistance on the 0–100 scale.
- Display watts (3-second average by default), current raw watts, and accumulated mechanical work in kJ.
- HR in BPM or profile zone, with the alternate reading underneath.
- Distance, calculated by integrating raw bike speed; it uses km or miles to match speed units.
- Estimated calories, calculated as mechanical work in kJ / (4.184 × 0.24), assuming 24% gross efficiency. These are estimates, not a separate measured calorie stream. [Power-to-calorie method](https://www.trainerroad.com/blog/calories-and-power/).

The server accumulates averages and totals from unsmoothed measurements and elapsed time, not packet counts. The preparation countdown and timer pauses are excluded. Cadence/speed zeros count when measured. Data gaps longer than five seconds are excluded, rather than silently filled with zeros or stale values. Whole-workout averages therefore cover available active-time data; they may have incomplete coverage after a long outage. Totals survive browser refreshes and native helper reconnections, remain visible at completion, and reset on a new ride. Restarting the Node server clears these in-memory totals. No FIT recording or Strava export is implemented yet.

Metric freshness is evaluated on the Mac and advanced on the browser’s monotonic clock. A different clock setting on the Peloton cannot hide fresh readings. Received update counts appear beside connection status when supplied by the helper. A lost signal leaves last readings visible in muted text while automatic recovery continues. The timer cards still show planned program targets; the live panel does not display target gauges.

HR, cadence, resistance and watts show actual/target readings for the current program block. The arrows indicate a requested correction: ↑ increase, ↓ decrease. Green means on target (within ±5% of a scalar target), amber means a small correction (5–10%), and coral means a large correction (over 10%). Large arrows are physically bigger. A one-percentage-point hysteresis margin on entering a new correction level reduces boundary flicker; arrows always clear within ±5%. Changing blocks resets this display state immediately.

Explicit `targetRanges` override scalar targets: the supplied range itself is on target, with deviation measured from its nearest boundary. Zero targets are handled without division by zero. Missing targets show **No target**; missing or stale readings never generate arrows. Correction colors and arrows only apply to explicitly primary targets (see below). Power comparisons use the displayed rolling average; other comparisons use current readings. HR comparisons always use BPM, even if the main reading is a profile zone. Speed, distance and calorie fields have no instantaneous targets in the current program schema.

Existing workout files are unchanged. Optional `heartRate` and `targetRanges` JSON fields can supply HR and explicit range targets for future programs.

At 1100px and wider, the landscape dashboard shows timers, live metrics and route in three columns. Narrower landscape tablets keep timers and live data side by side, with the route below. Phone-sized layouts stack. The bottom overlay space remains reserved.

For a clearly labeled synthetic layout preview without bike hardware, run `node scripts/preview-bike.mjs` and open `http://localhost:8094`. Its data is test-only and never connects to the native helper. Start a sample workout to display simulated readings.

Progress is saved in the current browser. Reopening offers to restore it **paused**, at the last saved position. No server account or cloud service is involved. Your bike's resistance remains manually controlled. The timer cards show planned targets; **Ride data** shows live telemetry when connected. Power targets from the spreadsheet remain estimates.

## Sample workouts

The `workouts/` folder contains the planned intervals from `Grupetto Workouts.xlsx`:

| Workout | Duration | Intervals |
| --- | ---: | ---: |
| 45-minute Tabata | 45 min | 97 |
| 90-minute fat burn | 90 min | 17 |
| Mt Peloton 90 minute climb | 90 min | 23 |
| 3 by 20-5 at 130 | 85 min | 7 |
| One-minute sound check | 1 min | 8 expanded |

Conversion preserves the workbook's planned durations and targets, rather than copying recorded average watts into the targets. The older three-climb sheet contains timing only; its missing targets are displayed as dashes rather than guessed from its title. Workbook notes, heart-rate data, and personal ride records are not bundled. Source sheet and row references are retained in JSON.

## Edit or add workouts

### Program tags

Admin tags are fixed by code and the deployed Program catalog. The standard tags are Climb, Intervals, Tabata, Endurance, Heart Rate Zone, Power Zone, Beginner and Low Impact. Catalog-specific labels such as Demo are also admin-owned. Edit `public/tags.js` and Program JSON `tags` as the system administrator, then redeploy. The browser cannot create, rename, delete or change Program assignments of admin tags; the server is read-only.

Use **Manage my tags** to create, rename or delete user tags. **Edit my tags** on each Program adds/removes existing tags or creates a new tag and assigns it in one dialog. Cancel discards that dialog’s changes. Deleting a user tag asks for confirmation and removes it from every assigned Program, including those not loaded. Admin and user tags both support any/all filtering.

User taxonomy and assignments are saved separately in this browser’s localStorage, under `pelotonic-reaction-tag-profile-v1:local`. Clearing browser data loses these user tags. They are not yet synchronized across browsers or users. Stable tag IDs preserve assignments through renaming; stable Program IDs preserve them across catalog reloads. Keep deployed Program IDs unique and unchanged.

`public/tag-profile.js` separates the profile model from its asynchronous load/save repository. When authentication is added, replace `BrowserTagProfileRepository` with an authenticated user-profile database API and enforce ownership on the server. No login or database is implemented here. Timer and History storage are unchanged.

Portable Program JSON supports admin `tags` and portable `userTags` names. Browser imports create/reuse custom user tags and ignore reserved admin labels; they cannot modify the admin catalog. Imported Programs still need to be deployed in `workouts/` for durable sharing. An already-loaded Program ID cannot be imported twice.

Edit a JSON file in `workouts/`, or create a new `.json` file there. Refresh the page to reload the catalog. Malformed workouts are reported by filename; valid workouts still load. There is no build step and no manifest to maintain.

All durations are **whole seconds**; cadence is RPM; resistance is the Peloton 0–100 scale; watts are the intended/estimated target. Omit a target or set it to `null` to leave it unspecified. Use standard JSON (no comments or trailing commas).

```json
{
  "schemaVersion": 1,
  "name": "My cadence intervals",
  "description": "Three rounds with a clear recovery cue.",
  "tags": ["Endurance"],
  "steps": [
    { "label": "Warm up", "kind": "warmup", "durationSeconds": 300, "cadence": 80, "resistance": 35, "watts": 78 },
    {
      "label": "Round",
      "repeat": 3,
      "steps": [
        { "label": "Steady", "kind": "work", "durationSeconds": 300, "cadence": 90, "resistance": 40, "watts": 134 },
        { "label": "Easy", "kind": "recovery", "durationSeconds": 300, "cadence": 80, "resistance": 35, "watts": 78 }
      ]
    },
    { "label": "Cool down", "kind": "cooldown", "durationSeconds": 300 }
  ]
}
```

`workout.schema.json` describes the format for editors supporting JSON Schema. Runtime validation also limits expanded workouts to 5,000 intervals, five levels of nested repeats, and 24 hours. **Import workout** loads a JSON file into the current browser for the current page session. To share it permanently, save that file in the server's `workouts/` directory.

## Refresh workouts from Excel

Python 3 is optional and needed only for conversion. It reads the workbook without modifying it and requires no third-party libraries:

```sh
python3 scripts/import_workbook.py "/path/to/Grupetto Workouts.xlsx"
```

On Windows, use `py` instead of `python3` if needed. Close/save Excel first so cached formula results are current. The converter updates the four named sample files from their source sheets; it does not remove custom JSON files. Review and commit updated files normally.

## Check

```sh
npm test
```

Tests cover interval/repeat validation, exact transitions, missed timer callbacks, pause/resume/seek, converted workout totals, catalog loading, and HTTP file-access boundaries.


## Posture, power zones and primary targets

Segments accept `posture: "seated" | "standing" | null` and `powerZone: 1..7 | null`. Omitted/null posture leaves the rider's position unspecified. A standing icon and label appear on the active/ready timer card, upcoming card and workout table for standing segments. Seated or unspecified posture shows no icon or label. Zone cues appear on the active and upcoming timer cards.

`primaryTargets` explicitly lists the metrics that generate correction arrows and deviation colors: `cadence`, `resistance`, `watts`, `heartRate`. Use `watts` for either a numerical watts target or a power-zone target. More than one primary is supported. Omitted, `null` or `[]` means no correction guidance; numerical targets remain visible as references. Null/absent target values remain untargeted. Only primary metrics receive correction colors/arrows, so estimated reference watts cannot conflict with cadence/resistance coaching.

```json
{
  "label": "Seated climb",
  "durationSeconds": 1200,
  "posture": "seated",
  "cadence": 80,
  "resistance": 42,
  "watts": 180,
  "primaryTargets": ["cadence", "resistance"]
}
```

For a power-zone segment, use `"powerZone": 3` and `"primaryTargets": ["watts"]`, omitting `watts` and `targetRanges.watts`. Conflicting zone and absolute power targets are rejected. Set FTP in Rider Profile to resolve zones into watts; FTP is optional and initially unset. Without FTP, the zone remains visible with a **set FTP** hint and no power correction. FTP is included in profile JSON exports and older profiles load with an unset FTP.

The seven zones use boundaries at 55%, 75%, 90%, 105%, 120% and 150% of FTP, with contiguous whole-watt ranges and Zone 7 open above 150%. For FTP 200 W: Z1 0–110, Z2 111–150, Z3 151–180, Z4 181–210, Z5 211–240, Z6 241–300, Z7 301+. Reference: [Peloton power-zone training](https://www.onepeloton.com/en-GB/blog/power-zone-training?locale=en-US&path=%2Fpower-zone-training).

The bundled workbook-derived workouts now explicitly guide cadence/resistance where available, keeping their existing estimated watts as reference. The timing-only 3×20 workout remains without targets or primary guidance. The workbook importer preserves authored posture, power-zone, primary-target and HR metadata by source row when refreshing a converted program.

An importable example is provided in `examples/primary-targets-and-power-zones.json`. Reopen bundled programs from the library to load their new primary-target metadata; an already-saved ride snapshot retains its original definition.
