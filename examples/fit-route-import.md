# Experimental Garmin FIT terrain import

On branch `codex/garmin-route-workout`, convert a manually exported original FIT activity:

```sh
mkdir -p .data/route-tests
node scripts/import_fit_route.mjs /absolute/path/activity.fit .data/route-tests/terrain.json 45
```

Unzip Garmin's export first. In PelotonicReaction, use **Import workout** to open the generated JSON. Set your FTP or power zones in Rider Profile to resolve power-zone cues into watts. Generated personal workouts belong in `.data/`, which is excluded from version control; they are not added to the shared catalog automatically. No GPS coordinates or recorded health samples are copied to the workout.

The prototype smooths elevation across approximately 400 m, classifies approximately 1 km sections, and merges consecutive sections with the same terrain. Average grades below -1% produce Zone 1 / 95 RPM descents; below 1.5%, Zone 2 / 85 RPM; below 5%, Zone 3 / 75 RPM; otherwise Zone 4 / 65 RPM climbs. It adds five minutes of warmup and three minutes of cooldown, and scales remaining time by section distance. These are editable experimental choices, not measured rider-specific prescriptions. Long climbs and descents can remain long blocks. Resistance is intentionally unspecified: adjust it to achieve the target watts and cadence on your bike. Recorded e-bike power and assisted speed are not used to prescribe intensity.

Test recording 25013628932 decoded without errors: 9,808 records, 43.09 km, session ascent 1,245 m, duration 2:43:28, eBikeFitness. The owner confirms that this Specialized bike broadcasts rider power only, excluding motor assistance. Its recorded watts are therefore usable for a future rider-effort replay mode; the eBikeFitness classification alone is not a reason to reject power data. Assisted speed still reflects motor assistance. The current converter uses terrain only and does not yet implement effort replay. The 45-minute output has 11 blocks, including a 12:53 Zone 4 climb and 16:24 downhill spin. This is a recognizable terrain interpretation; it needs rider review and potentially intensity/duration adjustments before use. No Strava segment names are available in this file.

## Saved direction for future exploration

Work is paused at a prototype, not a finished feature. The compelling use case is course-specific preparation for a PR on a defined real-world route, rather than automatically turning any recorded ride into a structured workout. A mountain-road version of Mt Peloton could preserve switchbacks, steep pitches, moderate sections and a summit, with an intentional pacing plan based on rider fitness and expected section durations. Gradient describes course demands; it does not by itself justify a particular power zone. Preserve realistic durations for full-course rehearsals; shorter sessions can rehearse selected sections explicitly.

The initial converter overmerges consecutive sections above 5% grade. Further local analysis of the 4–19 km climb found an overall grade of 6.2% and average rider power of 82 W, with full quarter-mile sections ranging approximately 2.7–9.6% grade. Consider quarter-mile or mile bins, sustained gradient-change boundaries, and nearby switchbacks as recognizable landmarks. A preliminary heading heuristic found 37 candidate sharp turns, not map-verified switchbacks. Any future segmentation should smooth elevation, preserve time-weighted rider power including genuine zeros, distinguish coasting from pedaling cadence, and enforce practical minimum block durations.

A possible future GPS mode would replace the right-hand workout table with a route map, current position, prior-effort ghost and elevation profile, retaining a table toggle. Neither map playback nor ghost racing is implemented. Progress could use bike distance initially or a calibrated power/gradient simulation later. Racing original e-bike timestamps includes the original assistance advantage; an equal-conditions comparison would need to simulate both efforts from rider watts under the same assumptions. Outdoor PR-time predictions remain estimates.

Local artifacts from this experiment (excluded from Git): `.data/route-tests/garmin-terrain-test.json`, `.data/route-tests/climb-analysis.json`, and `.data/route-tests/analyze-climb.mjs`. The supplied ZIP remains in Downloads. The reusable converter and synthetic tests are committed; the personal recording and generated artifacts are not. Last full validation: 70 tests passed, with local loopback access enabled for integration tests.
