import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM_TAGS, normalizeTags, availableTags, matchesTags } from '../public/tags.js';
import { compileWorkout } from '../public/workout.js';

const programs = [
  { name: 'Tabata', tags: ['Tabata', 'Intervals'] },
  { name: 'Climb', tags: ['Climb', 'Endurance'] },
  { name: 'Steady', tags: ['Endurance', 'Tempo'] },
  { name: 'Untagged' },
];

test('suggestions contain the eight requested labels without restricting custom tags', () => {
  assert.deepEqual(PROGRAM_TAGS, ['Climb', 'Intervals', 'Tabata', 'Endurance', 'Heart Rate Zone', 'Power Zone', 'Beginner', 'Low Impact']);
  assert.deepEqual(normalizeTags(['Tempo', 'Recovery day']), ['Tempo', 'Recovery day']);
});
test('normalization canonicalizes suggestions, aliases and whitespace and removes duplicate labels', () => {
  assert.deepEqual(normalizeTags([' tabata ', 'INTERVALS', 'Tabata', 'heart  rate\tzone', 'Climbing', 'climb', 'Tempo', 'tempo']), ['Tabata', 'Intervals', 'Heart Rate Zone', 'Climb', 'Tempo']);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags([]), []);
});
test('empty or malformed tags fail validation without accepting whitespace labels', () => {
  for (const tags of ['Tabata', [7], ['   '], ['x'.repeat(61)], Array(21).fill('Intervals')]) assert.throws(() => normalizeTags(tags));
});
test('match any and match all differ for overlapping tags, and no selection includes untagged programs', () => {
  const names = (tags, mode) => programs.filter(p => matchesTags(p, tags, mode)).map(p => p.name);
  assert.deepEqual(names(['Endurance', 'Climb'], 'any'), ['Climb', 'Steady']);
  assert.deepEqual(names(['Endurance', 'Climb'], 'all'), ['Climb']);
  assert.deepEqual(names(['Tabata', 'Endurance'], 'all'), []);
  assert.deepEqual(names([' tempo '], 'any'), ['Steady']);
  assert.deepEqual(names([], 'all'), ['Tabata', 'Climb', 'Steady', 'Untagged']);
  assert.equal(matchesTags({ tags: ['Custom 24'] }, Array.from({ length: 25 }, (_, i) => `Custom ${i}`)), true);
});
test('custom tags extend the library options and empty suggestions remain visible', () => {
  assert.deepEqual(availableTags([...programs, { tags: ['tempo', 'Climbing'] }]), [...PROGRAM_TAGS, 'Tempo']);
  assert.deepEqual(availableTags([]), PROGRAM_TAGS);
});
test('normalizing a program preserves its intervals and does not mutate source JSON', () => {
  const raw = { schemaVersion: 1, name: 'Tagged program', tags: [' tabata', 'TABATA', 'Intervals'], steps: [{ label: 'Ride', durationSeconds: 30 }] };
  const compiled = compileWorkout(raw);
  assert.deepEqual(compiled.tags, ['Tabata', 'Intervals']);
  assert.deepEqual(raw.tags, [' tabata', 'TABATA', 'Intervals']);
  assert.equal(compiled.totalSeconds, 30);
});
