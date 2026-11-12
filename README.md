# PelotonicReaction

A local cycling workout player for the view from your bike: large countdown, cadence, resistance and estimated watts; a preview of the next block; and an easy-to-follow workout profile.

## Run on Windows, macOS or Linux

Install **Node.js 18 or newer** (a current LTS release is recommended). No packages need to be downloaded or installed.

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

On the other device, open `http://YOUR-COMPUTER-LAN-IP:8080`. Allow the server through your firewall on your private network if prompted. This read-only server has no login; only share it on a trusted network. Do not expose it to the public internet. LAN clients share the catalog, while each browser runs its own independent session.

## Ride

1. Open a workout to inspect the targets and schedule.
2. Try **One-minute sound check** first; enable **Sound cues** and optionally **Spoken cues**.
3. Press **Start workout**. A short tone sounds at 3, 2 and 1 seconds remaining and a longer tone marks each new block.
4. Pause/resume any time. Previous, next and schedule/profile clicks let you move between blocks. A running ride pauses for confirmation before jumping.
5. Fullscreen enlarges the display. `Space` starts/pauses when the page has focus; arrow keys change blocks; `F` toggles fullscreen. Focused buttons keep their normal Space behavior.

The clock uses elapsed wall time, so delayed browser callbacks don't stretch an interval. If a tab was suspended, it catches up to the current block without replaying all missed cues. Keep the browser visible for dependable audio; browsers and operating systems can silence background tabs or sleeping devices. Speech depends on browser/device voice availability. The app requests a screen wake lock where supported (usually localhost or HTTPS); for plain HTTP over a LAN, disable automatic device sleep manually if needed.

Progress is saved in the current browser. Reopening offers to restore it **paused**, at the last saved position. No server account or cloud service is involved. Your bike's resistance remains manually controlled. The displayed targets are instructions, **not live telemetry**, and power from the spreadsheet is an estimate.

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

Export JSON includes admin `tags` and portable `userTags` names. Browser imports create/reuse custom user tags and ignore reserved admin labels; they cannot modify the admin catalog. Imported Programs still need to be deployed in `workouts/` for durable sharing. An already-loaded Program ID cannot be imported twice.

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

`workout.schema.json` describes the format for editors supporting JSON Schema. Runtime validation also limits expanded workouts to 5,000 intervals, five levels of nested repeats, and 24 hours. **Import workout** loads a JSON file into the current browser for the current page session. To share it permanently, save that file in the server's `workouts/` directory. **Export JSON** downloads the selected workout for editing or sharing.

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
