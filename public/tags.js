// Suggestions, not a closed taxonomy: programs may also use custom tags.
export const PROGRAM_TAGS = Object.freeze([
  'Climb', 'Intervals', 'Tabata', 'Endurance', 'Heart Rate Zone',
  'Power Zone', 'Beginner', 'Low Impact',
]);

const clean = tag => tag.normalize('NFC').trim().replace(/\s+/gu, ' ');
export const tagKey = tag => clean(tag).toLowerCase();
const suggested = new Map(PROGRAM_TAGS.map(tag => [tagKey(tag), tag]));
const aliases = new Map([['climbing', 'Climb']]);

export function normalizeTags(tags) {
  if (tags == null) return [];
  if (!Array.isArray(tags) || tags.length > 20) throw Error('tags must be an array of at most 20 text labels.');
  const result = [], seen = new Set();
  for (const tag of tags) {
    if (typeof tag !== 'string') throw Error('Each program tag must be text.');
    const label = clean(tag);
    if (!label || label.length > 60) throw Error('Each program tag must contain 1–60 characters.');
    const canonical = suggested.get(tagKey(label)) || aliases.get(tagKey(label)) || label;
    const key = tagKey(canonical);
    if (!seen.has(key)) { result.push(canonical); seen.add(key); }
  }
  return result;
}

export function availableTags(programs) {
  const labels = new Map(PROGRAM_TAGS.map(tag => [tagKey(tag), tag]));
  for (const program of programs) for (const tag of normalizeTags(program.tags)) if (!labels.has(tagKey(tag))) labels.set(tagKey(tag), tag);
  return [...PROGRAM_TAGS, ...[...labels.values()].filter(tag => !PROGRAM_TAGS.includes(tag)).sort((a, b) => a.localeCompare(b))];
}

export function matchesTags(program, selected, mode = 'any') {
  // The per-program limit does not constrain how many library filters can be selected.
  const requested = [...new Set(selected.flatMap(tag => normalizeTags([tag])).map(tagKey))];
  if (!requested.length) return true;
  const keys = new Set(normalizeTags(program.tags).map(tagKey));
  return mode === 'all' ? requested.every(key => keys.has(key)) : requested.some(key => keys.has(key));
}
