import { normalizeTags, tagKey } from './tags.js';

export function programKey(program) {
  if (typeof program.id === 'string' && program.id.trim()) return `program:${program.id.trim()}`;
  // Older imports without an ID keep their assignments across reload/import.
  const content = JSON.stringify({ name: program.name, steps: program.steps });
  let hash = 2166136261;
  for (const char of content) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `program:legacy-${(hash >>> 0).toString(16)}-${content.length}`;
}

export function adminTagId(label) { return `admin:${tagKey(label)}`; }

// Storage-independent, immutable-by-snapshot domain model. User IDs never encode names.
export class UserTagProfile {
  constructor(snapshot = { version: 1, tags: [], programTags: {} }, adminLabels = [], makeId = () => `user:${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`) {
    this.adminKeys = new Set(adminLabels.map(label => tagKey(normalizeTags([label])[0])));
    this.makeId = makeId;
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tags) || snapshot.tags.length > 500 || !snapshot.programTags || typeof snapshot.programTags !== 'object' || Array.isArray(snapshot.programTags)) throw Error('The user tag profile has an unsupported format.');
    this.tags = snapshot.tags.map(tag => {
      if (!tag || typeof tag.id !== 'string' || !tag.id.startsWith('user:') || typeof tag.name !== 'string') throw Error('The user tag profile contains an invalid tag.');
      return { id: tag.id, name: normalizeTags([tag.name])[0] };
    });
    if (new Set(this.tags.map(t => t.id)).size !== this.tags.length || new Set(this.tags.map(t => tagKey(t.name))).size !== this.tags.length) throw Error('The user tag profile contains duplicate tags.');
    const ids = new Set(this.tags.map(t => t.id));
    this.programTags = {};
    for (const [key, values] of Object.entries(snapshot.programTags)) {
      if (!key.startsWith('program:') || !Array.isArray(values) || values.length > 20 || values.some(id => typeof id !== 'string' || !ids.has(id))) throw Error('The user tag profile contains invalid Program assignments.');
      this.programTags[key] = [...new Set(values)];
    }
  }
  snapshot() { return { version: 1, tags: this.tags.map(t => ({ ...t })), programTags: Object.fromEntries(Object.entries(this.programTags).map(([k, ids]) => [k, [...ids]])) }; }
  fork() { return new UserTagProfile(this.snapshot(), [...this.adminKeys], this.makeId); }
  getTag(id) { const tag = this.tags.find(t => t.id === id); if (!tag) throw Error(id?.startsWith('admin:') ? 'Admin tags are read-only.' : 'This user tag no longer exists.'); return tag; }
  validateName(name, exceptId) {
    const label = normalizeTags([name])[0];
    if (this.adminKeys.has(tagKey(label))) throw Error('That name belongs to an admin tag. Choose a different name.');
    if (this.tags.some(t => t.id !== exceptId && tagKey(t.name) === tagKey(label))) throw Error('A user tag with that name already exists.');
    return label;
  }
  createTag(name) {
    if (this.tags.length >= 500) throw Error('Your profile can contain at most 500 user tags.');
    const tag = { id: this.makeId(), name: this.validateName(name) };
    if (!tag.id.startsWith('user:') || this.tags.some(t => t.id === tag.id)) throw Error('Unable to generate a unique user tag ID.');
    this.tags.push(tag); return { ...tag };
  }
  renameTag(id, name) { const tag = this.getTag(id); tag.name = this.validateName(name, id); }
  assignmentCount(id) { this.getTag(id); return Object.values(this.programTags).filter(ids => ids.includes(id)).length; }
  deleteTag(id) {
    this.getTag(id); const count = this.assignmentCount(id);
    this.tags = this.tags.filter(t => t.id !== id);
    // Includes Programs that are not currently loaded into the library.
    for (const [key, ids] of Object.entries(this.programTags)) { const next = ids.filter(value => value !== id); if (next.length) this.programTags[key] = next; else delete this.programTags[key]; }
    return count;
  }
  tagsForProgram(key) { return (this.programTags[key] || []).map(id => this.getTag(id)); }
  setProgramTags(key, ids) {
    if (typeof key !== 'string' || !key.startsWith('program:')) throw Error('This Program needs a valid ID.');
    if (!Array.isArray(ids) || ids.length > 20) throw Error('Choose at most 20 user tags for a Program.');
    for (const id of ids) this.getTag(id);
    const unique = [...new Set(ids)];
    if (unique.length) this.programTags[key] = unique; else delete this.programTags[key];
  }
  addTagToProgram(key, id) { this.setProgramTags(key, [...new Set([...(this.programTags[key] || []), id])]); }
  removeTagFromProgram(key, id) { this.getTag(id); this.setProgramTags(key, (this.programTags[key] || []).filter(value => value !== id)); }
}

// Replace this load/save adapter with a signed-in profile API later. No model/UI changes needed.
export class BrowserTagProfileRepository {
  constructor(storage, profileId = 'local') { this.storage = storage; this.key = `pelotonic-reaction-tag-profile-v1:${profileId}`; }
  async load() {
    const raw = this.storage.getItem(this.key);
    return raw === null ? { version: 1, tags: [], programTags: {} } : JSON.parse(raw);
  }
  async save(snapshot) { this.storage.setItem(this.key, JSON.stringify(snapshot)); }
}
