import { startWorkout } from './workout-start.js';
import { RideScreenReminder } from './screen-reminder.js';
import { segmentStyle, targetVisual } from './workout-visuals.js';
import { programKey } from './tag-profile.js';
import { distanceUnit, formatRouteLabel } from './measurement-units.js';
import { TerrainView } from './terrain.js';
import { scheduleColumns, scheduleTarget } from './schedule-targets.js';
import { RideHistory } from './ride-history.js';
import { standingBadge, renderPosture } from './posture.js';
import { segmentInstructions, formatProgramTarget, isPrimaryTarget } from './target-guidance.js';
import { compileWorkout, positionAt, WorkoutClock, formatTime, formatDistance } from './workout.js';
import { normalizeTags } from './tags.js';
import { BikePanel } from './bike-panel.js';
import { TagControls } from './tag-controls.js';
const $ = id => document.getElementById(id);
fetch('/api/version').then(response=>{if(!response.ok)throw Error();return response.json();}).then(build=>{const label=$('server-version');label.textContent=`Server v${build.version} · Build ${build.buildNumber||'development'}${build.commit?' · '+build.commit.slice(0,8):''}${build.dirty?' · modified':''}`;label.title=build.builtAt?`Built ${build.builtAt}`:'';}).catch(()=>{$('server-version').textContent='Server version unavailable';});
const key = 'pelotonic-reaction-session-v1';
const bikePanel = new BikePanel();
const screenReminder=new RideScreenReminder($('screen-reminder'),{onShow:()=>{if($('sound').checked)tone(660,.2);}});
for(const type of ['pointerdown','touchstart','wheel','keydown'])document.addEventListener(type,event=>screenReminder.handleInteraction(event),{capture:true,passive:true});
let previewDistanceKm = null;
const terrainView = new TerrainView($('terrain-view'), { onPreview: distance => { previewDistanceKm = distance; } });
let mapWorkout = false, lastRouteDistance = null, distanceSessionId = null, distanceOffsetKm = 0;
const distanceMode = () => selected?.completionMetric === 'distance';
const ridePosition = () => positionAt(selected, clock.read(), (previewDistanceKm ?? lastRouteDistance ?? 0) * 1000);
const stepLength = step => distanceMode() ? formatDistance(step.distanceMeters, bikePanel.unit) : formatTime(step.durationSeconds);
const remainingLabel = value => distanceMode() ? formatDistance(value, bikePanel.unit) : formatTime(value);
function resetDistance() { bikePanel.routeOffsetKm = 0; bikePanel.routeDistanceKm = 0; lastRouteDistance = null; distanceSessionId = null; distanceOffsetKm = 0; }
$('route-table-toggle').onclick = () => { const show = $('schedule').hidden; $('schedule').hidden = !show; $('timeline').hidden = !show; $('route-table-toggle').textContent = show ? 'Hide workout blocks' : 'Show workout blocks'; };
const rideHistory = new RideHistory();
let selected = null, rawSelected = null, clock = null, currentIndex = -1, audio = null, wake = null, lastCue = '', completed = false, workoutItems = [];
let selectedTags = [];
const tagControls = new TagControls({ onChange: renderLibrary, confirm: ask });
function el(tag, text, cls) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; }
function storageGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function storageSet(k, value) { try { localStorage.setItem(k, JSON.stringify(value)); } catch { /* Private browsing and storage quotas do not prevent a ride. */ } }
function displayTarget(v) { return v == null ? '—' : String(Math.round(v * 10) / 10); }
function ask(title, message, action = 'Continue') {
  return new Promise(resolve => {
    $('dialog-ok').textContent = action; const dialog = $('confirm-dialog'); $('dialog-title').textContent = title; $('dialog-copy').textContent = message;
    const done = value => { dialog.close(); $('dialog-ok').onclick = null; $('dialog-cancel').onclick = null; dialog.oncancel = null; resolve(value); };
    $('dialog-ok').onclick = () => done(true); $('dialog-cancel').onclick = () => done(false); dialog.oncancel = event => { event.preventDefault(); done(false); }; dialog.showModal();
  });
}
function saveSession() { if (clock && selected) storageSet(key, { workout: rawSelected, elapsed: clock.read(), completed, rideId: bikePanel.rideId, routeDistance: lastRouteDistance, distanceSessionId, distanceOffsetKm,screenReminder:screenReminder.snapshot() }); }
async function releaseWake() { try { await wake?.release(); } catch {} wake = null; $('sleep-status').textContent = ''; }
async function holdWake() {
  if (!clock?.running || document.visibilityState !== 'visible') return;
  if (!('wakeLock' in navigator)) { $('sleep-status').textContent = 'Keep this screen awake in your device settings.'; return; }
  try { if (!wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } $('sleep-status').textContent = 'Screen stays awake while riding.'; }
  catch { $('sleep-status').textContent = 'Automatic screen wake unavailable. Check device sleep settings.'; }
}
async function enableAudio() {
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { audio ||= new AC(); await audio.resume(); } } catch {}
}
function tone(frequency = 700, duration = .12) {
  if (!$('sound').checked || !audio || audio.state !== 'running') return;
  const osc = audio.createOscillator(), gain = audio.createGain(); osc.connect(gain); gain.connect(audio.destination); osc.frequency.value = frequency;
  gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.14, audio.currentTime + .015); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration); osc.start(); osc.stop(audio.currentTime + duration + .02);
}
function speak(text) {
  if (!$('voice').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel(); const cue = new SpeechSynthesisUtterance(text); cue.rate = 1.03; speechSynthesis.speak(cue);
}
function announce(interval) {
  const phrase = `${formatRouteLabel(interval.label,bikePanel.unit)}. ${interval.posture ? interval.posture + '.' : ''} ${interval.powerZone != null ? 'Power zone ' + interval.powerZone + '.' : ''} ${interval.cadence == null ? '' : `${displayTarget(interval.cadence)} RPM.`} ${interval.resistance == null ? '' : `Resistance ${displayTarget(interval.resistance)}.`} ${interval.watts == null ? '' : `${Math.round(interval.watts)} watts.`}`;
  $('announcement').textContent = phrase; speak(phrase);
}
function height(step) { return `${segmentStyle(step,bikePanel.profile).height*100}%`; }
function colorStep(node,step){const visual=segmentStyle(step,bikePanel.profile);node.style.background=visual.background;node.style.setProperty('--cue',visual.color);}

function renderLibrary() {
  const programs = workoutItems.map(item => item.workout), entries = tagControls.entries();
  selectedTags = selectedTags.filter(id => entries.some(t => t.id === id));
  const mode = $('tag-match').value, active = new Set(selectedTags);
  const hasTags = program => { const ids = new Set(tagControls.forProgram(program).map(t => t.id)); return !selectedTags.length || (mode === 'all' ? selectedTags.every(id => ids.has(id)) : selectedTags.some(id => ids.has(id))); };
  const matches = workoutItems.filter(item => hasTags(item.workout));
  const focusedTag = document.activeElement?.dataset.tag;
  $('admin-tag-filters').replaceChildren(); $('user-tag-filters').replaceChildren();
  for (const tag of entries) {
    const count = programs.filter(p => tagControls.forProgram(p).some(t => t.id === tag.id)).length;
    const button = el('button', null, 'tag-filter'); button.dataset.tag = tag.id;
    button.setAttribute('aria-pressed', String(active.has(tag.id)));
    button.setAttribute('aria-label', `${tag.label} (${count})`);
    button.append(el('span', tag.label), el('span', count, 'tag-count'));
    button.onclick = () => { selectedTags = active.has(tag.id) ? selectedTags.filter(id => id !== tag.id) : [...selectedTags, tag.id]; renderLibrary(); };
    $(`${tag.scope}-tag-filters`).append(button);
    if (focusedTag === tag.id) button.focus();
  }
  if (!tagControls.profile.tags.length) $('user-tag-filters').append(el('span', 'Create your own tags with Manage my tags or on a Program.', 'subtle'));
  $('clear-tags').disabled = selectedTags.length === 0;
  $('filter-status').textContent = `${matches.length} of ${programs.length} Programs${selectedTags.length ? ` · matching ${mode} of: ${entries.filter(t => active.has(t.id)).map(t => t.label).join(', ')}` : ' · select tags to filter'}`;
  showCards(matches);
  if (!matches.length) {
    const empty = el('div', null, 'empty-programs'); empty.append(el('h2', 'No Programs match yet.'), el('p', selectedTags.length ? 'Try another tag, match any selected tag, or clear the filters.' : 'Import a Program JSON file to get started.'));
    if (selectedTags.length) { const clear = el('button', 'Show all Programs', 'outline'); clear.onclick = clearTags; empty.append(clear); }
    $('workout-cards').append(empty);
  }
}
function clearTags() { selectedTags = []; renderLibrary(); }
$('clear-tags').onclick = clearTags;
$('tag-match').onchange = renderLibrary;
function showCards(items) {
  $('workout-cards').replaceChildren();
  for (const item of items) {
    const raw = item.workout, w = compileWorkout(raw), card = el('article', null, 'workout-card');
    const tags = el('div', null, 'program-tags');
    for (const tag of tagControls.forProgram(raw)) { const chip = el('span', tag.label, `program-tag ${tag.scope}-tag`); chip.title = tag.scope === 'admin' ? 'Admin tag · read-only' : 'Your user tag'; tags.append(chip); }
    if (!tags.children.length) tags.append(el('span', 'Untagged', 'program-tag untagged'));
    card.append(tags, el('h2', w.name), el('p', raw.description || 'Your next workout, one interval at a time.'));
    const profile = el('div', null, 'mini-profile'); profile.setAttribute('aria-hidden', 'true');
    for (const step of w.intervals) { const bar = el('span', null, step.kind); bar.style.flexGrow = w.completionMetric === 'distance' ? step.distanceMeters : step.durationSeconds; bar.style.height = height(step); colorStep(bar,step); profile.append(bar); }
    const stats = el('div', null, 'card-stats'); const duration = el('div'); duration.append(el('strong', w.completionMetric === 'distance' ? formatDistance(w.totalDistanceMeters, bikePanel.unit, 1).split(' ')[0] : Math.round(w.totalSeconds / 60)), el('span', w.completionMetric === 'distance' ? ' '+distanceUnit(bikePanel.unit) : ' min')); const count = el('span', `${w.intervals.length} blocks`); stats.append(duration, count);
    const button = el('button', 'Open workout →', 'outline'); button.onclick = () => selectWorkout(raw); const editTags = el('button', 'Edit my tags', 'quiet'); editTags.setAttribute('aria-label', `Edit my tags for ${w.name}`); editTags.disabled = Boolean(tagControls.error); editTags.onclick = () => tagControls.editProgram(raw); card.append(stats, profile, button, editTags);
    if (item.imported) {
      const actions=el('div',null,'saved-workout-actions');
      const rename=el('button','Rename','quiet');rename.setAttribute('aria-label',`Rename ${w.name}`);rename.onclick=()=>openRenameWorkout(item);
      const remove=el('button','Delete','quiet');remove.setAttribute('aria-label',`Delete ${w.name}`);remove.onclick=()=>deleteWorkout(item,remove);
      actions.append(rename,remove);card.append(actions);
    }
    $('workout-cards').append(card);
  }
}
let renamingWorkout=null;
function openRenameWorkout(item) {
  renamingWorkout=item;$('workout-name-input').value=item.workout.name;$('rename-workout-error').textContent='';
  $('rename-workout-dialog').showModal();$('workout-name-input').focus();$('workout-name-input').select();
}
$('rename-workout-cancel').onclick=()=>$('rename-workout-dialog').close();
async function changeSavedWorkout(item,method,name) {
  const response=await fetch('/api/workouts/saved/'+encodeURIComponent(item.filename),{method,headers:{'Content-Type':'application/json'},...(name===undefined?{}:{body:JSON.stringify({name})})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Could not change the saved workout.');return result;
}
function updateSavedSession(before,after) {
  const saved=storageGet(key);
  if(saved?.workout && programKey(saved.workout)===programKey(before)) {
    if(after)storageSet(key,{...saved,workout:after});
    else {try{localStorage.removeItem(key);}catch{}}
  }
  if(rawSelected && programKey(rawSelected)===programKey(before)) {
    if(after) {rawSelected=after;selected=compileWorkout(after);bikePanel.workoutName=after.name;}
    else {rawSelected=null;selected=null;clock=null;}
  }
}
$('rename-workout-form').onsubmit=async event=>{
  event.preventDefault();const item=renamingWorkout;const name=$('workout-name-input').value.trim();
  if(!name){$('rename-workout-error').textContent='Enter a workout name.';return;}
  $('rename-workout-save').disabled=true;
  try {
    const result=await changeSavedWorkout(item,'PATCH',name);updateSavedSession(item.workout,result.workout);Object.assign(item,result);
    renderLibrary();$('rename-workout-dialog').close();$('notice').textContent=`Renamed workout to ${result.workout.name}.`;
  }catch(error){$('rename-workout-error').textContent=error.message;}
  finally{$('rename-workout-save').disabled=false;}
};
async function deleteWorkout(item,button) {
  if(!await ask('Delete saved workout?',`Delete “${item.workout.name}” from your library? Recorded rides will be kept.`))return;
  button.disabled=true;
  try {
    await changeSavedWorkout(item,'DELETE');updateSavedSession(item.workout,null);workoutItems=workoutItems.filter(w=>w!==item);renderLibrary();
    $('notice').textContent=`Deleted ${item.workout.name}.`;
  }catch(error){$('notice').textContent=error.message;button.disabled=false;}
}
function buildSchedule() {
  $('timeline').replaceChildren(); $('schedule').replaceChildren();
  const columns=scheduleColumns(selected.intervals);
  $('schedule').style.setProperty('--target-columns',columns.length);
  $('schedule').dataset.targetColumns=columns.length;
  const head = el('div', null, 'schedule-head'); for (const label of ['BLOCK', distanceMode() ? 'DISTANCE / LEFT' : 'DURATION / LEFT', ...columns.map(c=>c.label)]) head.append(el('span', label)); $('schedule').append(head);
  selected.intervals.forEach((step, index) => {
    const bar = el('button'); bar.dataset.kind = step.kind; bar.style.flexGrow = distanceMode() ? step.distanceMeters : step.durationSeconds; bar.style.height = height(step); colorStep(bar,step); bar.title = `${formatRouteLabel(step.label,bikePanel.unit)} · ${stepLength(step)}`; bar.setAttribute('aria-label', `Go to ${formatRouteLabel(step.label,bikePanel.unit)}`); bar.onclick = () => jump(index); $('timeline').append(bar);
    if (distanceMode()) { bar.disabled = true; bar.title = 'Segments advance by distance traveled'; }
    const row = el('button'); row.disabled = distanceMode(); row.dataset.index = index; row.setAttribute('aria-label', `Go to ${formatRouteLabel(step.label,bikePanel.unit)}, ${stepLength(step)}`);
    const duration = el('span', stepLength(step), 'block-duration');
    const blockLabel = el('strong', null, 'block-label'); blockLabel.append(el('span', formatRouteLabel(step.label,bikePanel.unit)));
    if (step.cue) blockLabel.append(el('small', step.cue, 'schedule-cue'));
    const postureBadge = standingBadge(step); if (postureBadge) { blockLabel.append(postureBadge); row.setAttribute('aria-label', `${row.getAttribute('aria-label')}, standing`); }
    row.append(blockLabel, duration);
    for(const column of columns){
      const target=scheduleTarget(step,column), cell=el('span',target.text,'schedule-target');
      cell.classList.toggle('schedule-primary',target.primary);
      if(target.text!=='—'){const visual=targetVisual(step,column.key,bikePanel.profile);cell.style.setProperty('--target-color',visual.color);cell.style.color=visual.color;cell.style.borderBottom=`2px solid ${visual.color}`;}
      cell.title=`${column.label}: ${target.text}${target.primary?' · Primary target':''}`;
      if(target.primary)cell.setAttribute('aria-label',`${column.label}: ${target.text}, primary target`);
      row.append(cell);
      if(target.text!=='—')row.setAttribute('aria-label',`${row.getAttribute('aria-label')}, ${column.label} ${target.text}${target.primary?' primary':''}`);
    }
    row.onclick = () => jump(index); $('schedule').append(row);
  });
}
async function selectWorkout(raw, elapsed = 0, rideId = null, savedDistance = null) {
  if (selected) bikePanel.end();
  if (clock?.running) { clock.pause(); saveSession(); await releaseWake(); }
  try { selected = compileWorkout(raw); } catch (e) { $('notice').textContent = e.message; return; }
  bikePanel.workoutName = selected.name; bikePanel.workoutDescription = selected.description; bikePanel.rideId = rideId;
  rawSelected = { ...raw, tags: selected.tags }; clock = new WorkoutClock(distanceMode() ? Infinity : selected.totalSeconds); clock.seek(elapsed); currentIndex = -1; completed = !distanceMode() && elapsed >= selected.totalSeconds; lastCue = '';
  $('library').hidden = true; $('player').hidden = false; document.body.classList.add('workout-open'); document.body.classList.remove('workout-completed'); $('ride-name').textContent = selected.name; $('ride-description').textContent = selected.description || ''; $('total-label').textContent = formatTime(selected.totalSeconds);
  resetDistance();
  if (distanceMode() && savedDistance) { lastRouteDistance = Number.isFinite(savedDistance.routeDistance) ? Math.max(0,savedDistance.routeDistance) : null; distanceSessionId = savedDistance.distanceSessionId || rideId; distanceOffsetKm = Number.isFinite(savedDistance.distanceOffsetKm) ? Math.max(0,savedDistance.distanceOffsetKm) : 0; }
  bikePanel.virtualRoute = selected.tags.includes('Spinulator') ? selected.route : null;
  bikePanel.routeOffsetKm = distanceOffsetKm;
  $('total-label').previousElementSibling.textContent = distanceMode() ? 'ROUTE DISTANCE' : 'PROGRAM TIME';
  $('total-label').textContent = distanceMode() ? formatDistance(selected.totalDistanceMeters, bikePanel.unit) : formatTime(selected.totalSeconds);
  $('ride-remaining').previousElementSibling.textContent = distanceMode() ? 'DISTANCE LEFT' : 'REMAINING';
  $('next-duration').setAttribute('aria-label',distanceMode()?'Next block distance':'Next block duration');
  document.querySelector('.upcoming .clock-caption').textContent = distanceMode() ? 'BLOCK DISTANCE' : 'BLOCK DURATION';
  mapWorkout = terrainView.setWorkout(selected);
  $('route-heading').textContent = mapWorkout ? 'Explore the route' : 'The route ahead';
  $('route-table-toggle').hidden = !mapWorkout; $('route-table-toggle').textContent = 'Show workout blocks';
  $('timeline').hidden = mapWorkout; $('schedule').hidden = mapWorkout;
  buildSchedule();
  if (elapsed > 0 && !completed) bikePanel.begin();
  screenReminder.restore(savedDistance?.screenReminder);render();saveSession();
  window.scrollTo({ top: 0 });
}
async function jump(index) {
  if (distanceMode() || !selected || index < 0 || index >= selected.intervals.length) return;
  const wasRunning = clock.running;
  if (wasRunning) { clock.pause(); render(); await releaseWake(); if (!await ask('Change block?', `Jump to ${selected.intervals[index].label}? The workout will continue from that block.`)) { clock.start(); holdWake(); return; } }
  clock.seek(selected.intervals[index].startSeconds); completed = false; currentIndex = -1; lastCue = '';
  if (wasRunning) { clock.start(); holdWake(); }
  render(); saveSession(); window.scrollTo({ top: 0, behavior: 'instant' });
}
async function toggle() {
  if (!clock) return;
  terrainView.stopPreview();
  if (completed) { resetDistance(); document.body.classList.remove('workout-completed'); clock.seek(0); completed = false; currentIndex = -1; lastCue = ''; render(); }
  if (clock.running) { clock.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); await releaseWake(); }
  else { startWorkout(clock,{begin:()=>bikePanel.begin(),enableAudio}); holdWake(); const p = ridePosition(); if (!clock.countdownRemaining && !p.done && p.index === currentIndex) announce(selected.intervals[p.index]); }
  render(); saveSession();
}
let renderedUnit = null, renderedProfile = null;
function render() {
  screenReminder.update({rideId:bikePanel.rideId,started:!!selected&&!completed&&bikePanel.desired&&!!clock&&(clock.running||clock.read()>0)});
  if (renderedUnit !== bikePanel.unit || renderedProfile !== bikePanel.profile) {renderedUnit=bikePanel.unit;renderedProfile=bikePanel.profile;terrainView.setUnits(bikePanel.unit);renderLibrary();if(selected){buildSchedule();currentIndex=-1;$('total-label').textContent=distanceMode()?formatDistance(selected.totalDistanceMeters,bikePanel.unit):formatTime(selected.totalSeconds);}}
  if (!selected || !clock) return;
  terrainView.setPreviewAllowed(!clock.running && clock.read() === 0 && !bikePanel.desired);
  const previewing = previewDistanceKm != null;
  const preparing = clock.countdownRemaining > 0;
  terrainView.setRideRunning(clock.running && !preparing);
  if (mapWorkout || distanceMode()) {
    const snapshot = bikePanel.snapshot;
    if (bikePanel.desired && clock.running && !preparing && snapshot.rideId === bikePanel.rideId && Number.isFinite(snapshot.ride?.distanceKm)) {
      if (distanceSessionId !== snapshot.rideId) { distanceOffsetKm = lastRouteDistance || 0; distanceSessionId = snapshot.rideId; }
      lastRouteDistance = Math.max(lastRouteDistance || 0, distanceOffsetKm + snapshot.ride.distanceKm);
    }
    bikePanel.routeDistanceKm = lastRouteDistance;
    terrainView.update(lastRouteDistance, Boolean(snapshot.connected && bikePanel.desired));
  }
  const activePosition = ridePosition();
  const activeStep = selected.intervals[activePosition.index];
  bikePanel.remainingSeconds = distanceMode() ? null : Math.max(0, selected.totalSeconds-clock.read());
  bikePanel.setStep(previewing || activePosition.done ? null : activeStep, activePosition.index);
  $('current-cue').textContent = activeStep?.cue || '';
  $('next-cue').textContent = !activePosition.done ? selected.intervals[activePosition.index + 1]?.cue || '' : '';
  renderPosture($('current-posture'), activeStep);
  $('segment-instructions').textContent = segmentInstructions(activeStep);
  bikePanel.setRecording(!previewing && clock.running && !preparing && !ridePosition().done);
  const p = ridePosition(), changed = p.index !== currentIndex;
  $('route-block-count').textContent = `${p.done ? selected.intervals.length : p.index + 1} / ${selected.intervals.length}`;
  if (preparing) {
    currentIndex = -1;
    $('phase').textContent = clock.running ? 'GET READY' : 'COUNTDOWN PAUSED';
    $('interval-label').textContent = 'Your ride starts in…';
    $('countdown').textContent = formatTime(clock.countdownRemaining);
    $('countdown').setAttribute('aria-label', 'Time until workout starts');
    $('clock-caption').textContent = 'WORKOUT STARTS IN';
    $('toggle').textContent = clock.running ? 'Pause Ⅱ' : 'Resume countdown ▶';
    const cue = Math.ceil(clock.countdownRemaining);
    if (clock.running && lastCue !== `start:${cue}`) {
      lastCue = `start:${cue}`;
      if (cue <= 3) tone(600, .09);
      $('announcement').textContent = `Workout starts in ${cue} seconds.`;
    }
    return;
  }
  $('countdown').setAttribute('aria-label', distanceMode() ? 'Distance remaining in block' : 'Time remaining in block');
  if (!previewing && p.done && !completed) { completed = true; document.body.classList.add('workout-completed'); bikePanel.end('complete').then(() => rideHistory.refresh()); clock.pause(); releaseWake(); tone(1000, .5); speak('Workout complete. Nice ride.'); $('announcement').textContent = 'Workout complete.'; saveSession(); }
  if (changed) {
    currentIndex = p.index;
    for (const [index, node] of [...$('timeline').children].entries()) { node.classList.toggle('active', index === p.index); node.setAttribute('aria-current', index === p.index ? 'step' : 'false'); }
    for (const node of $('schedule').querySelectorAll('[data-index]')) { node.classList.toggle('active', Number(node.dataset.index) === p.index); node.setAttribute('aria-current', Number(node.dataset.index) === p.index ? 'step' : 'false'); node.querySelector('.block-duration').removeAttribute('aria-label'); node.querySelector('.block-duration').textContent = stepLength(selected.intervals[Number(node.dataset.index)]); }
    // Move only the block list, keeping the timer and page stationary.
    const activeRow = $('schedule').querySelector('[aria-current="step"]');
    if (activeRow) {
      const list = $('schedule'), header = list.querySelector('.schedule-head');
      list.scrollTop = Math.max(0, activeRow.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - header.offsetHeight - list.clientTop);
    }
    if (clock.running && p.index >= 0) { tone(880, .25); announce(selected.intervals[p.index]); }
  }
  const step = selected.intervals[p.index], next = selected.intervals[p.index + 1];
  $('stage').dataset.kind = step?.kind || 'cooldown';
  $('stage').style.setProperty('--cue',segmentStyle(step,bikePanel.profile).color);
  $('phase').textContent = previewing ? (p.done ? 'PREVIEW COMPLETE' : 'PREVIEW · NOT RECORDING') : p.done ? 'COMPLETE' : clock.running ? ({ warmup: 'WARM UP', work: 'WORK', recovery: 'RECOVERY', cooldown: 'COOL DOWN' }[step.kind]) : clock.read() === 0 ? 'READY TO RIDE' : 'PAUSED';
  $('step-count').textContent = `${p.done ? selected.intervals.length : p.index + 1} / ${selected.intervals.length} BLOCKS`;
  $('interval-label').textContent = p.done ? (previewing ? 'Route preview complete' : 'Workout complete. Nice ride.') : formatRouteLabel(step.label,bikePanel.unit);
  const activeDuration = $('schedule').querySelector('[aria-current="step"] .block-duration');
  if (activeDuration) {
    activeDuration.textContent = `${remainingLabel(p.remaining)} left`;
    activeDuration.setAttribute('aria-label', `${remainingLabel(p.remaining)} remaining in block`);
  }
  $('distance-progress').hidden = !distanceMode();
  $('distance-progress').textContent = distanceMode() ? `${Math.min(100,p.done ? 100 : Math.floor((step.distanceMeters - p.remaining) / step.distanceMeters * 100))}% of segment · ${Math.min(100,Math.floor(p.distance / selected.totalDistanceMeters * 100))}% of route` : '';
  $('countdown').textContent = remainingLabel(p.remaining); $('clock-caption').textContent = p.done ? (previewing ? 'PREVIEW COMPLETE' : 'WORKOUT COMPLETE') : distanceMode() ? 'DISTANCE REMAINING' : 'BLOCK REMAINING';
  for (const id of ['cadence', 'resistance', 'watts']) {
    const key = id === 'watts' ? 'power' : id;
    $(id).textContent = formatProgramTarget(step, key, bikePanel.profile);
    $(id).parentElement.classList.toggle('primary-program-target', isPrimaryTarget(step, key));
    $(id).classList.toggle('range-target', $(id).textContent.includes('–') || $(id).textContent.includes('+'));
  }
  $('elapsed').textContent = formatTime(Math.floor(p.elapsed)); $('ride-remaining').textContent = distanceMode() ? formatDistance(selected.totalDistanceMeters - p.distance, bikePanel.unit) : formatTime(selected.totalSeconds - p.elapsed);
  $('session-progress').style.width = `${(distanceMode() ? p.distance / selected.totalDistanceMeters : p.elapsed / selected.totalSeconds) * 100}%`; const length = distanceMode() ? step?.distanceMeters : step?.durationSeconds; $('block-progress').style.width = p.done ? '100%' : `${(length - p.remaining) / length * 100}%`;
  $('toggle').textContent = previewing ? 'Start workout ▶' : p.done ? 'Ride again ↻' : clock.running ? 'Pause Ⅱ' : clock.read() === 0 ? 'Start workout ▶' : 'Resume ▶';
  $('previous').disabled = distanceMode() || p.index === 0; $('next').disabled = distanceMode() || p.done || p.index >= selected.intervals.length - 1;
  $('next-name').textContent = p.done ? (previewing ? 'Preview finished' : 'Time to recover.') : (next ? formatRouteLabel(next.label,bikePanel.unit) : 'Finish line');
  $('next-duration').textContent = next && !p.done ? stepLength(next) : '—';
  document.querySelector('.upcoming').dataset.kind = next?.kind || 'cooldown';
  document.querySelector('.upcoming').style.setProperty('--cue',segmentStyle(next,bikePanel.profile).color);
  renderPosture($('next-posture'), !p.done ? next : null);
  $('next-instructions').textContent = !p.done ? segmentInstructions(next) : '';
  $('next-targets').replaceChildren();
  for (const [key, label, unit] of [['cadence', 'CADENCE', 'RPM'], ['resistance', 'RESISTANCE', ''], ['watts', 'POWER', 'W']]) {
    const metric = el('div'), title = el('span', null, 'metric-title');
    title.append(document.createTextNode(label + ' '), el('small', unit));
    metric.classList.toggle('primary-program-target', isPrimaryTarget(next, key === 'watts' ? 'power' : key));
    const targetText = !p.done ? formatProgramTarget(next, key === 'watts' ? 'power' : key, bikePanel.profile) : '—';
    metric.append(title, el('strong', targetText, targetText.includes('–') || targetText.includes('+') ? 'range-target' : ''));
    $('next-targets').append(metric);
  }
  const cue = Math.ceil(p.remaining);
  if (!distanceMode() && clock.running && cue >= 1 && cue <= 3 && lastCue !== `${p.index}:${cue}`) { lastCue = `${p.index}:${cue}`; tone(600, .09); }
}
$('toggle').onclick = toggle; $('previous').onclick = () => jump(currentIndex === -1 ? selected.intervals.length - 1 : currentIndex - 1); $('next').onclick = () => jump(currentIndex + 1);
$('restart').onclick = async () => { if (!clock) return; clock.pause(); render(); releaseWake(); if (await ask('Restart this ride?', 'Return to the beginning? Your current progress will be replaced.')) { document.body.classList.remove('workout-completed'); bikePanel.end(); resetDistance(); clock.seek(0); currentIndex = -1; completed = false; render(); saveSession(); } };
$('back').onclick = () => { terrainView.destroy(); bikePanel.end().then(() => rideHistory.refresh()); clock?.pause(); saveSession(); releaseWake(); if ('speechSynthesis' in window) speechSynthesis.cancel(); $('player').hidden = true; $('library').hidden = false; document.body.classList.remove('workout-open','workout-completed'); document.title = 'PelotonicReaction · Workout player'; };
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('sleep-status').textContent = 'Fullscreen is unavailable in this browser.'; } };
$('import-open').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  const isFit=/\.fit$/i.test(file.name);
  $('import-open').disabled=true;
  try {
    let workout, savedFilename;
    if (isFit) {
      if(file.size>10*1024*1024)throw Error('Choose a FIT file no larger than 10 MB.');
      $('notice').textContent='Importing FIT route…';
      const response=await fetch('/api/workouts/import-fit?'+new URLSearchParams({name:file.name}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      const result=await response.json();if(!response.ok)throw Error(result.error||'FIT import failed.');
      if(!result.filename)throw Error('Restart the app/server to enable saved imports, then import this file again.');
      workout=result.workout;savedFilename=result.filename;
    } else {
      if(!/\.json$/i.test(file.name))throw Error('Choose a workout JSON or FIT file. Unzip Garmin exports first.');
      if(file.size>2*1024*1024)throw Error('Choose a JSON file smaller than 2 MB.');
      workout=JSON.parse(await file.text());
    }
    const checked=compileWorkout(workout);workout.tags=checked.tags;
    const imported=await tagControls.prepareImport(workout,workoutItems.map(item=>item.workout));
    // FIT tags are produced by our converter, not supplied by arbitrary imported JSON.
    if(isFit)imported.tags=checked.tags;
    else {
      const response=await fetch('/api/workouts/import-json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(imported)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save the workout.');savedFilename=result.filename;
    }
    workoutItems.unshift({filename:savedFilename,workout:imported,imported:true});selectedTags=[];renderLibrary();
    $('notice').textContent=`Saved ${workout.name} to your local workout library.${isFit?' Imported as a distance-based Spinulator workout. Set your FTP/power zones and review the generated targets before riding.':''} It will remain available after refreshing or restarting the app.`;
  }
  catch (error) { $('notice').textContent = `Could not import workout: ${error.message}`; }
  finally {e.target.value='';$('import-open').disabled=false;}
};
for (const id of ['sound', 'voice']) { const stored = storageGet(`pr-${id}`); if (typeof stored === 'boolean') $(id).checked = stored; $(id).onchange = () => { storageSet(`pr-${id}`, $(id).checked); if (id === 'voice' && !$(id).checked && 'speechSynthesis' in window) speechSynthesis.cancel(); }; }
window.addEventListener('keydown', e => { if (e.target.closest('input,textarea,select,dialog') || e.altKey || e.metaKey || e.ctrlKey || $('confirm-dialog').open) return; if (e.code === 'KeyF') { e.preventDefault(); $('fullscreen').click(); } if ($('player').hidden) return; if (e.code === 'Space' && !e.target.closest('button,a')) { e.preventDefault(); toggle(); } else if (e.code === 'ArrowRight') { e.preventDefault(); jump(currentIndex + 1); } else if (e.code === 'ArrowLeft') { e.preventDefault(); jump(currentIndex - 1); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); holdWake(); } else saveSession(); });
window.addEventListener('pagehide', saveSession);
setInterval(render, 100); setInterval(saveSession, 2000);
async function init() {
  try { const response = await fetch('/api/workouts'); if (!response.ok) throw Error('The workout server did not respond.'); const data = await response.json(); workoutItems = data.workouts.map(item => ({ ...item, workout: { ...item.workout, tags: normalizeTags(item.workout.tags) } })); await tagControls.init(workoutItems.map(item => item.workout)); renderLibrary(); if (data.errors?.length) $('notice').textContent = data.errors.map(e => `${e.filename}: ${e.message}`).join('\n'); if (!workoutItems.length) $('notice').textContent += '\nNo workouts found. Add a valid JSON file to workouts/ or import one.'; }
  catch (e) { await tagControls.init([]); renderLibrary(); $('notice').textContent = `${e.message} Start the app with npm start, then refresh. You can also import a JSON workout.`; }
  const saved = storageGet(key);
  if (saved && !saved.completed && Number.isFinite(saved.elapsed) && saved.elapsed > 0) {
    try { compileWorkout(saved.workout); if (await ask('Continue your last ride?', `${saved.workout.name} · ${formatTime(saved.elapsed)} completed. It will reopen paused.`)) await selectWorkout(saved.workout, saved.elapsed, saved.rideId, saved); } catch { /* Ignore invalid or outdated saved sessions. */ }
  }
  if ($('player').hidden) bikePanel.end();
}
init();
