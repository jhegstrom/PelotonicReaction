import { compileWorkout, positionAt, WorkoutClock, formatTime } from './workout.js';
import { normalizeTags } from './tags.js';
import { TagControls } from './tag-controls.js';
const $ = id => document.getElementById(id);
const key = 'pelotonic-reaction-session-v1';
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
function saveSession() { if (clock && selected) storageSet(key, { workout: rawSelected, elapsed: clock.read(), completed }); }
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
  const phrase = `${interval.label}. ${interval.cadence == null ? '' : `${displayTarget(interval.cadence)} RPM.`} ${interval.resistance == null ? '' : `Resistance ${displayTarget(interval.resistance)}.`} ${interval.watts == null ? '' : `${Math.round(interval.watts)} watts.`}`;
  $('announcement').textContent = phrase; speak(phrase);
}
function height(step) { return `${Math.max(14, Math.min(100, 14 + (step.watts || 70) / 4))}%`; }
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
    for (const step of w.intervals) { const bar = el('span', null, step.kind); bar.style.flexGrow = step.durationSeconds; bar.style.height = height(step); profile.append(bar); }
    const stats = el('div', null, 'card-stats'); const duration = el('div'); duration.append(el('strong', Math.round(w.totalSeconds / 60)), el('span', ' min')); const count = el('span', `${w.intervals.length} blocks`); stats.append(duration, count);
    const button = el('button', 'Open workout →', 'outline'); button.onclick = () => selectWorkout(raw); const editTags = el('button', 'Edit my tags', 'quiet'); editTags.setAttribute('aria-label', `Edit my tags for ${w.name}`); editTags.disabled = Boolean(tagControls.error); editTags.onclick = () => tagControls.editProgram(raw); card.append(stats, profile, button, editTags); $('workout-cards').append(card);
  }
}
function buildSchedule() {
  $('timeline').replaceChildren(); $('schedule').replaceChildren();
  const head = el('div', null, 'schedule-head'); for (const label of ['START', 'BLOCK', 'LENGTH', 'RPM', 'RESISTANCE', 'WATTS']) head.append(el('span', label)); $('schedule').append(head);
  selected.intervals.forEach((step, index) => {
    const bar = el('button'); bar.dataset.kind = step.kind; bar.style.flexGrow = step.durationSeconds; bar.style.height = height(step); bar.title = `${formatTime(step.startSeconds)} · ${step.label}`; bar.setAttribute('aria-label', `Go to ${step.label}`); bar.onclick = () => jump(index); $('timeline').append(bar);
    const row = el('button'); row.dataset.index = index; row.setAttribute('aria-label', `Go to ${step.label}, ${formatTime(step.durationSeconds)}`);
    row.append(el('small', formatTime(step.startSeconds)), el('strong', step.label), el('span', formatTime(step.durationSeconds)), el('span', displayTarget(step.cadence)), el('span', displayTarget(step.resistance)), el('span', step.watts == null ? '—' : Math.round(step.watts)));
    row.onclick = () => jump(index); $('schedule').append(row);
  });
}
async function selectWorkout(raw, elapsed = 0) {
  if (clock?.running) { clock.pause(); saveSession(); await releaseWake(); }
  try { selected = compileWorkout(raw); } catch (e) { $('notice').textContent = e.message; return; }
  rawSelected = { ...raw, tags: selected.tags }; clock = new WorkoutClock(selected.totalSeconds); clock.seek(elapsed); currentIndex = -1; completed = elapsed >= selected.totalSeconds; lastCue = '';
  $('library').hidden = true; $('player').hidden = false; $('ride-name').textContent = selected.name; $('ride-description').textContent = selected.description || ''; $('total-label').textContent = `${formatTime(selected.totalSeconds)} total · ${selected.intervals.length} blocks`;
  buildSchedule(); render(); saveSession(); window.scrollTo({ top: 0 });
}
async function jump(index) {
  if (!selected || index < 0 || index >= selected.intervals.length) return;
  const wasRunning = clock.running;
  if (wasRunning) { clock.pause(); render(); await releaseWake(); if (!await ask('Change block?', `Jump to ${selected.intervals[index].label}? The workout will continue from that block.`)) { clock.start(); holdWake(); return; } }
  clock.seek(selected.intervals[index].startSeconds); completed = false; currentIndex = -1; lastCue = '';
  if (wasRunning) { clock.start(); holdWake(); }
  render(); saveSession(); window.scrollTo({ top: 0, behavior: 'instant' });
}
async function toggle() {
  if (!clock) return;
  if (completed) { clock.seek(0); completed = false; currentIndex = -1; }
  if (clock.running) { clock.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); await releaseWake(); }
  else { await enableAudio(); clock.start(); holdWake(); const p = positionAt(selected, clock.read()); if (!p.done && p.index === currentIndex) announce(selected.intervals[p.index]); }
  render(); saveSession();
}
function render() {
  if (!selected || !clock) return;
  const p = positionAt(selected, clock.read()), changed = p.index !== currentIndex;
  if (p.done && !completed) { completed = true; clock.pause(); releaseWake(); tone(1000, .5); speak('Workout complete. Nice ride.'); $('announcement').textContent = 'Workout complete.'; saveSession(); }
  if (changed) {
    currentIndex = p.index;
    for (const [index, node] of [...$('timeline').children].entries()) { node.classList.toggle('active', index === p.index); node.setAttribute('aria-current', index === p.index ? 'step' : 'false'); }
    for (const node of $('schedule').querySelectorAll('[data-index]')) { node.classList.toggle('active', Number(node.dataset.index) === p.index); node.setAttribute('aria-current', Number(node.dataset.index) === p.index ? 'step' : 'false'); }
    if (clock.running && p.index >= 0) { tone(880, .25); announce(selected.intervals[p.index]); }
  }
  const step = selected.intervals[p.index], next = selected.intervals[p.index + 1];
  $('stage').dataset.kind = step?.kind || 'cooldown';
  $('phase').textContent = p.done ? 'COMPLETE' : clock.running ? ({ warmup: 'WARM UP', work: 'WORK', recovery: 'RECOVERY', cooldown: 'COOL DOWN' }[step.kind]) : clock.read() === 0 ? 'READY TO RIDE' : 'PAUSED';
  $('step-count').textContent = `${p.done ? selected.intervals.length : p.index + 1} / ${selected.intervals.length} BLOCKS`;
  $('interval-label').textContent = p.done ? 'Workout complete. Nice ride.' : step.label;
  $('countdown').textContent = formatTime(p.remaining); $('clock-caption').textContent = p.done ? 'YOU MADE THE TIME.' : 'BLOCK REMAINING';
  for (const id of ['cadence', 'resistance', 'watts']) $(id).textContent = step ? displayTarget(id === 'watts' && step[id] != null ? Math.round(step[id]) : step[id]) : '—';
  $('elapsed').textContent = formatTime(Math.floor(p.elapsed)); $('ride-remaining').textContent = formatTime(selected.totalSeconds - p.elapsed);
  $('session-progress').style.width = `${p.elapsed / selected.totalSeconds * 100}%`; $('block-progress').style.width = p.done ? '100%' : `${(step.durationSeconds - p.remaining) / step.durationSeconds * 100}%`;
  $('toggle').textContent = p.done ? 'Ride again ↻' : clock.running ? 'Pause Ⅱ' : clock.read() === 0 ? 'Start workout ▶' : 'Resume ▶';
  $('previous').disabled = p.index === 0; $('next').disabled = p.done || p.index >= selected.intervals.length - 1;
  $('next-name').textContent = p.done ? 'Time to recover.' : next?.label || 'Finish line'; $('next-duration').textContent = p.done ? 'Workout finished' : next ? `${formatTime(next.durationSeconds)} next block` : 'Your last block';
  $('next-targets').replaceChildren(); if (next && !p.done) for (const [v, unit] of [[next.cadence, 'rpm'], [next.resistance, 'resistance'], [next.watts, 'W']]) if (v != null) $('next-targets').append(el('div', `${Math.round(v * 10) / 10} ${unit}`));
  const cue = Math.ceil(p.remaining);
  if (clock.running && cue >= 1 && cue <= 3 && lastCue !== `${p.index}:${cue}`) { lastCue = `${p.index}:${cue}`; tone(600, .09); }
}
$('toggle').onclick = toggle; $('previous').onclick = () => jump(currentIndex === -1 ? selected.intervals.length - 1 : currentIndex - 1); $('next').onclick = () => jump(currentIndex + 1);
$('restart').onclick = async () => { if (!clock) return; clock.pause(); render(); releaseWake(); if (await ask('Restart this ride?', 'Return to the beginning? Your current progress will be replaced.')) { clock.seek(0); currentIndex = -1; completed = false; render(); saveSession(); } };
$('back').onclick = () => { clock?.pause(); saveSession(); releaseWake(); if ('speechSynthesis' in window) speechSynthesis.cancel(); $('player').hidden = true; $('library').hidden = false; document.title = 'PelotonicReaction · Workout player'; };
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('sleep-status').textContent = 'Fullscreen is unavailable in this browser.'; } };
$('download').onclick = () => { const blob = new Blob([JSON.stringify(tagControls.exportProgram(rawSelected), null, 2) + '\n'], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `${selected.id || 'workout'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('import-open').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try { if (file.size > 2 * 1024 * 1024) throw Error('Choose a JSON file smaller than 2 MB.'); const workout = JSON.parse(await file.text()); const checked = compileWorkout(workout); workout.tags = checked.tags; const imported = await tagControls.prepareImport(workout, workoutItems.map(item => item.workout)); workoutItems.unshift({ workout: imported }); selectedTags = []; renderLibrary(); $('notice').textContent = `Imported ${workout.name}. Imported custom tags are your user tags. Admin tags are managed at deployment. To share the Program, put its JSON file in the server’s workouts folder.`; }
  catch (error) { $('notice').textContent = `Could not import workout: ${error.message}`; }
  e.target.value = '';
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
    try { compileWorkout(saved.workout); if (await ask('Continue your last ride?', `${saved.workout.name} · ${formatTime(saved.elapsed)} completed. It will reopen paused.`)) await selectWorkout(saved.workout, saved.elapsed); } catch { /* Ignore invalid or outdated saved sessions. */ }
  }
}
init();
