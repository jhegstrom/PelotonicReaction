# Experimental Garmin FIT terrain import

On branch `codex/garmin-route-workout`, convert a manually exported original FIT activity:

```sh
mkdir -p .data/route-tests
node scripts/import_fit_route.mjs /absolute/path/activity.fit .data/route-tests/terrain.json 45
```

Unzip Garmin's export first. In PelotonicReaction, use **Import workout** to open the generated JSON. Set your FTP or power zones in Rider Profile to resolve power-zone cues into watts. Generated personal workouts belong in `.data/`, which is excluded from version control; they are not added to the shared catalog automatically. GPS coordinates, distance, elevation, and supplied course-point names are copied into the workout for Spinulator playback. Recorded health samples are not copied. Treat exported workout JSON as location data.

The prototype smooths elevation across approximately 400 m, classifies approximately 1 km sections, and merges consecutive sections with the same terrain. Average grades below -1% produce Zone 1 / 95 RPM descents; below 1.5%, Zone 2 / 85 RPM; below 5%, Zone 3 / 75 RPM; otherwise Zone 4 / 65 RPM climbs. It estimates section times by distance and uses the first and final easy sections as warmup/cooldown. These are editable experimental choices, not measured rider-specific prescriptions. Long climbs and descents can remain long blocks. Resistance is intentionally unspecified: adjust it to achieve the target watts and cadence on your bike. Recorded e-bike power and assisted speed are not used to prescribe intensity.

Test recording 25013628932 decoded without errors: 9,808 records, 43.09 km, session ascent 1,245 m, duration 2:43:28, eBikeFitness. The owner confirms that this Specialized bike broadcasts rider power only, excluding motor assistance. Its recorded watts are therefore usable for a future rider-effort replay mode; the eBikeFitness classification alone is not a reason to reject power data. Assisted speed still reflects motor assistance. The current converter uses terrain only and does not yet implement effort replay. The 45-minute output has 11 blocks, including a 12:53 Zone 4 climb and 16:24 downhill spin. This is a recognizable terrain interpretation; it needs rider review and potentially intensity/duration adjustments before use. No Strava segment names are available in this file.

## Saved direction for future exploration

Work is paused at a prototype, not a finished feature. The compelling use case is course-specific preparation for a PR on a defined real-world route, rather than automatically turning any recorded ride into a structured workout. A mountain-road version of Mt Peloton could preserve switchbacks, steep pitches, moderate sections and a summit, with an intentional pacing plan based on rider fitness and expected section durations. Gradient describes course demands; it does not by itself justify a particular power zone. Preserve realistic durations for full-course rehearsals; shorter sessions can rehearse selected sections explicitly.

The initial converter overmerges consecutive sections above 5% grade. Further local analysis of the 4–19 km climb found an overall grade of 6.2% and average rider power of 82 W, with full quarter-mile sections ranging approximately 2.7–9.6% grade. Consider quarter-mile or mile bins, sustained gradient-change boundaries, and nearby switchbacks as recognizable landmarks. A preliminary heading heuristic found 37 candidate sharp turns, not map-verified switchbacks. Any future segmentation should smooth elevation, preserve time-weighted rider power including genuine zeros, distinguish coasting from pedaling cadence, and enforce practical minimum block durations.

Spinulator workouts now replace the right-hand block table with a gradient-colored elevation profile and an offline bird’s-eye GPS trace, retaining a table toggle. Optional online 3D terrain follows actual ride distance. Ghost racing is not implemented. Progress could use bike distance initially or a calibrated power/gradient simulation later. Racing original e-bike timestamps includes the original assistance advantage; an equal-conditions comparison would need to simulate both efforts from rider watts under the same assumptions. Outdoor PR-time predictions remain estimates.

Local artifacts from this experiment (excluded from Git): `.data/route-tests/garmin-terrain-test.json`, `.data/route-tests/climb-analysis.json`, and `.data/route-tests/analyze-climb.mjs`. The supplied ZIP remains in Downloads. The reusable converter and synthetic tests are committed; the personal recording and generated artifacts are not. Last full validation: 70 tests passed, with local loopback access enabled for integration tests.

## Spinulator workouts and written cues

Intervals accept an optional `cue` string (up to 500 characters), displayed beneath the label on both current and next timer cards and in the block schedule. FIT imports supply terrain-specific coaching, with power as the primary goal and cadence as supporting guidance.

The `Spinulator` admin tag selects route display. Add `route.points` with increasing `distance` in metres starting at zero, `altitude` in metres, and optional `lat` / `lon` in decimal degrees. At most 20,000 points are accepted. `route.landmarks` accepts up to 1,000 `{distance, name}` entries for navigation and scenery callouts. FIT imports preserve named course points. These are supplied names, not inferred or map-verified trail junctions. Add verified canyon, peak, and junction labels to landmarks to build a richer guided ride.

Map imports set `completionMetric: "distance"` and give every step a `distanceMeters` length. A segment ends when bike distance traveled reaches its endpoint. The same reading drives segment percent complete, overall route percent, the elevation marker and the map camera. Duration is an estimate only; reaching the estimated duration does not complete a segment or stop recording. First and final easy route sections serve as warmup/cooldown, without additional timed bookends. Distance modes show kilometres remaining on the timer cards. Previous/next and table jumps are disabled because route distance determines the active segment.

Distance comes directly from the existing ride distance shown on the timer page (bike speed integrated over active recording time), not a terrain simulation. Countdown and pauses are excluded. Disconnects hold the last position; a resumed recording can continue from its saved route distance. Restart resets route progress. Distance is clamped at the route end. Indoor distance is still an approximation of outdoor progress. Original timed workouts retain their existing timer behavior.

Click **Load 3D terrain** to load MapLibre GL JS 6.18.0, OpenFreeMap map tiles, and Mapzen/AWS elevation tiles. No subscription, API key, Google service or Strava subscription is used. Map assets need internet/WebGL and make tile requests to those providers; the elevation profile and GPS trace work offline. Visible map/elevation attributions are retained. The view is a cartographic 3D terrain map, not satellite photography. **Follow ride** uses a tilted camera and look-ahead bearing to navigate bends in the course; **Overview** returns to the entire route. Reduced-motion preferences disable camera transitions. Actual terrain depends on online elevation coverage, while the profile uses FIT elevations.

For Creel Spring, generate a personal 60-minute example with:

```sh
node scripts/import_fit_route.mjs /Users/johnhegstrom/Downloads/Creel_Spring_Single_Tracks.fit .data/route-tests/creel-spring-60-minute.json 60
```

Import that JSON from the workout library. The converter produces 11 distance-based terrain blocks for this route with its current smoothing and merging rules; this differs from a manually curated 14-block plan. The FIT contains five named course points, not a complete guide to its junctions or scenery.

## Aerial terrain and preview

Map view now defaults to USGS aerial imagery over 1.5× exaggerated terrain, with automatic track-up and a tilted chase camera. Surface can switch to Trail map, and terrain height offers 1×, 1.5×, 2× and 3×. USGS imagery is intended for US routes; switch to Trail map where aerial coverage is unavailable. Visible attribution remains on the map. Exaggeration affects rendering only; FIT elevation, gradients and workout targets are unchanged.

Before starting the timer, **Preview flyover** loads the map and plays the route with no bike connection or recording. Speeds are 10×, 30×, 60× and 120× relative to a 25 km/h preview pace. Pause/resume, a distance scrubber, replay and Exit preview are available. Expand terrain opens a larger viewer. The route marker, profile and target cards use preview position while the mode is active, clearly marked PREVIEW; actual ride distance and the workout clock stay untouched. Starting the real workout exits preview and resets the display to actual distance. Preview cannot run during an active or paused ride. Returning to the library destroys its playback timer.

Imagery service: https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer (USDA / USGS The National Map). Existing OpenFreeMap and Mapzen/AWS elevation sources remain in use; no API keys or subscription are required. Tile availability and internet speed affect preview quality.

## Session-loaded geographic names

When online 3D terrain opens (directly or through Preview flyover), the viewer fetches USGS GNIS landform, stream-label, and other water-feature names for the route bounds plus a small surrounding margin. Names remain in memory for that map session; they are not imported into the workout JSON, localStorage, or an application database. Returning to the library discards the map and its names. A new session fetches them again. Panning does not issue additional geographic-name queries. Normal browser HTTP caching may still apply.

**Place names** toggles this overlay. The base map independently supplies road/trail labels where mapped. GNIS labels are geographic context, not verified route crossings, trail access guidance, or route stops. GNIS coverage is US-focused; this query does not provide peak elevations or a complete trailhead inventory. No elevations are inferred from the ride or invented for peaks. Labels stay at their supplied geographic coordinates, and multi-point records are label positions rather than river polylines. A failed lookup leaves the ride and map running; toggling the overlay can retry. Route areas spanning more than two degrees are excluded from this prototype lookup.

Verified on the November 15 recording: live labels include Russell Peak, Creel Spring, Truckee Range, Mud Lake Slough, Marble Bluff, and Truckee River. The additional service receives the route area's bounding rectangle, not the FIT recording or power/heart-rate samples. No AI is used. Source: https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer

## Display units

The existing rider measurement preference now controls route elevation and distance as well as bike speed. Strava's `measurement_preference` is already imported as `speedUnit` (`feet` → `mph`, `meters` → `km/h`); it takes precedence when supplied. Without it, Rider Profile → Measurement units is editable locally. Metric shows kilometres/metres/km/h; US customary shows miles/feet/mph. Profile axes, accessible descriptions, elevation readouts, landmark approach distances, route totals, remaining distances, library distance cards and generated block-range labels follow that preference. Authored descriptive prose is left intact. Gradient percentages and stored SI route values do not change.

## Automatic major-high-point panoramas

With the online map loaded and Follow ride enabled, Summit panoramas triggers once at each detected major route high point in a preview or ride. Detection resamples elevation every 100 m and smooths five samples. A high point needs at least 60 m of preceding rise and 40 m of subsequent fall within 2.5 km; candidates within 1 km are grouped. A sustained climb ending at its high point is also eligible. These are route high points, not assertions that the route reaches a named mountain summit. Scrubbing/jumps larger than 500 m do not trigger tours.

The approximately 18-second sequence uses a three-second approach followed by one 15-second circular orbit, then returns directly to route following. There is no stationary panorama. A fixed absolute altitude is selected once to clear the highest sampled ground along a 9 km orbit and the summit by at least 3,000 m, avoiding reactions to terrain height changes or late tile updates. The orbit points down toward the route high point. It is a simulated elevated map view, not recorded video. Terrain/imagery resolution and exaggeration affect the scene.

Preview distance holds during the sequence and resumes afterward. Actual ride timing, telemetry, and recording continue. Pause preview freezes the sequence; Skip panorama returns to normal following. Overview, map dragging, disabling Follow ride or Summit panoramas, and leaving the workout cancel the sequence. Automatic panoramas are off initially when the browser prefers reduced motion. All camera changes are display-only and do not modify recorded route data or workout targets.

Preview now has separate Resume/Start and Pause controls. Pause is idempotent: repeated taps cannot resume playback. It removes the playback interval, cancels summit animation frames, and stops any in-flight map transition. Resume explicitly recreates the interval and resumes a frozen panorama. Button labels change only on state transitions, not on every playback tick. Verified unchanged route positions across browser checks during both normal preview and a summit orbit.


## Persistent UI imports

Import workout now saves FIT-derived and JSON workouts in `.data/imported-workouts/` beneath the app’s user-data directory. The catalog combines these with deployed workouts. Imports survive page reloads, browser closure, and app/server restarts; the original FIT bytes are decoded in memory and not retained. Saved JSON includes route GPS/elevation, so it remains private local data and is excluded from Git and packaged app resources. User tags remain browser-profile data; imported JSON cannot establish admin tags, while trusted FIT conversion supplies Spinulator/Power Zone tags. Files are published atomically without overwriting duplicates. Failed saves produce an error rather than a success notice. Previously lost session-only imports need to be imported once again after restarting the updated server.

The route-workout admin tag is now **Spinulator**. FIT imports receive it automatically. Legacy `Map` tags normalize to `Spinulator`, so older saved/imported workouts keep their route views and existing Program IDs.
