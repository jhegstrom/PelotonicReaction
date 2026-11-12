import { availableTags, normalizeTags, tagKey } from './tags.js';
import { adminTagId, programKey, UserTagProfile, BrowserTagProfileRepository } from './tag-profile.js';

const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };

export class TagControls {
  constructor({ onChange, confirm }) { this.onChange = onChange; this.confirm = confirm; this.adminLabels = []; this.profile = new UserTagProfile(); this.error = ''; this.editingId = null; this.busy = false; }
  async init(programs) {
    // Only build/deploy catalog metadata can establish admin tags. Browser imports cannot.
    this.adminLabels = availableTags(programs);
    try { this.repository = new BrowserTagProfileRepository(window.localStorage); this.profile = new UserTagProfile(await this.repository.load(), this.adminLabels); }
    catch { this.error = 'Your user tags could not be loaded. Existing browser data has been left untouched.'; this.profile = new UserTagProfile(undefined, this.adminLabels); }
    $('manage-user-tags').disabled = Boolean(this.error);
    $('profile-storage-status').textContent = this.error || 'User tags are saved in this browser. Account sync will be added with sign-in.';
    $('manage-user-tags').onclick = () => { this.resetManagerForm(); this.renderManager(); $('user-tags-dialog').showModal(); };
    $('user-tags-close').onclick = () => $('user-tags-dialog').close();
    $('user-tag-form').onsubmit = event => { event.preventDefault(); this.saveManagerTag(); };
    $('cancel-tag-rename').onclick = () => this.resetManagerForm();
    $('program-tags-cancel').onclick = () => $('program-tags-dialog').close();
    $('program-tags-save').onclick = () => this.saveAssignments();
    $('program-new-tag-form').onsubmit = event => { event.preventDefault(); this.createDraftTag(); };
  }
  entries() { return [...this.adminLabels.map(label => ({ id: adminTagId(label), label, scope: 'admin' })), ...this.profile.tags.map(t => ({ id: t.id, label: t.name, scope: 'user' })).sort((a, b) => a.label.localeCompare(b.label))]; }
  forProgram(program) {
    return [...normalizeTags(program.tags).map(label => ({ id: adminTagId(label), label, scope: 'admin' })), ...this.profile.tagsForProgram(programKey(program)).filter(t => !this.profile.adminKeys.has(tagKey(t.name))).map(t => ({ id: t.id, label: t.name, scope: 'user' }))];
  }
  async persist(next) {
    if (this.error) throw Error(this.error);
    if (this.busy) throw Error('Please wait for the current tag change to finish.');
    this.busy = true;
    try { await this.repository.save(next.snapshot()); this.profile = next; }
    catch (e) { throw Error(`Could not save user tags: ${e.message}. Your previous saved tags are unchanged.`); }
    finally { this.busy = false; }
    this.onChange();
  }
  resetManagerForm() { this.editingId = null; $('user-tag-name').value = ''; $('user-tag-submit').textContent = 'Create tag'; $('cancel-tag-rename').hidden = true; $('user-tags-message').textContent = ''; }
  renderManager() {
    $('admin-tag-list').replaceChildren(...this.adminLabels.map(label => el('span', `${label} · admin`, 'program-tag admin-tag')));
    $('my-tag-list').replaceChildren();
    if (!this.profile.tags.length) $('my-tag-list').append(el('p', 'No user tags yet. Create one below.', 'subtle'));
    for (const tag of [...this.profile.tags].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = el('div', null, 'user-tag-row'); const name = el('div'); name.append(el('strong', tag.name), el('small', `${this.profile.assignmentCount(tag.id)} Programs`));
      const rename = el('button', 'Rename', 'outline'); rename.setAttribute('aria-label', `Rename ${tag.name}`); rename.onclick = () => { this.editingId = tag.id; $('user-tag-name').value = tag.name; $('user-tag-submit').textContent = 'Save name'; $('cancel-tag-rename').hidden = false; $('user-tags-message').textContent = ''; $('user-tag-name').focus(); };
      const remove = el('button', 'Delete', 'quiet danger'); remove.setAttribute('aria-label', `Delete ${tag.name}`); remove.onclick = () => this.deleteTag(tag.id);
      row.append(name, rename, remove); $('my-tag-list').append(row);
    }
  }
  async saveManagerTag() {
    try {
      const next = this.profile.fork(), name = $('user-tag-name').value;
      if (this.editingId) next.renameTag(this.editingId, name); else next.createTag(name);
      await this.persist(next); this.resetManagerForm(); this.renderManager(); $('user-tags-message').textContent = 'User tag saved.';
    } catch (e) { $('user-tags-message').textContent = e.message; }
  }
  async deleteTag(id) {
    try {
      const tag = this.profile.getTag(id), count = this.profile.assignmentCount(id);
      if (!await this.confirm('Delete user tag?', `Delete “${tag.name}”? This removes the tag from all ${count} Programs where you assigned it, including Programs not currently loaded. This cannot be undone.`, 'Delete tag')) return;
      const next = this.profile.fork(); next.deleteTag(id); await this.persist(next);
      this.resetManagerForm(); this.renderManager(); $('user-tags-message').textContent = `Deleted “${tag.name}” and removed it from ${count} Programs.`;
    } catch (e) { $('user-tags-message').textContent = e.message; }
  }
  editProgram(program) {
    if (this.error) return;
    this.draft = this.profile.fork(); this.draftKey = programKey(program); this.draftIds = new Set(this.draft.tagsForProgram(this.draftKey).map(t => t.id));
    $('program-tags-title').textContent = `My tags · ${program.name}`; $('program-tags-message').textContent = ''; $('program-new-tag-name').value = '';
    const admin = normalizeTags(program.tags); $('program-admin-tags').replaceChildren(...admin.map(label => el('span', label, 'program-tag admin-tag')));
    if (!admin.length) $('program-admin-tags').append(el('span', 'No admin tags', 'subtle'));
    this.renderDraft(); $('program-tags-dialog').showModal();
  }
  renderDraft() {
    $('program-user-tags').replaceChildren();
    if (!this.draft.tags.length) $('program-user-tags').append(el('p', 'Create a user tag to label this Program.', 'subtle'));
    for (const tag of [...this.draft.tags].sort((a, b) => a.name.localeCompare(b.name))) {
      const label = el('label', null, 'assignment-tag'), checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = tag.id; checkbox.checked = this.draftIds.has(tag.id);
      checkbox.onchange = () => { if (checkbox.checked) this.draftIds.add(tag.id); else this.draftIds.delete(tag.id); };
      label.append(checkbox, el('span', tag.name)); $('program-user-tags').append(label);
    }
  }
  createDraftTag() {
    try { const tag = this.draft.createTag($('program-new-tag-name').value); this.draftIds.add(tag.id); $('program-new-tag-name').value = ''; this.renderDraft(); $('program-tags-message').textContent = 'New tag selected. Save tags to keep it.'; }
    catch (e) { $('program-tags-message').textContent = e.message; }
  }
  async saveAssignments() {
    try { this.draft.setProgramTags(this.draftKey, [...this.draftIds]); await this.persist(this.draft); $('program-tags-dialog').close(); }
    catch (e) { $('program-tags-message').textContent = e.message; }
  }
  exportProgram(program) { return { ...program, userTags: this.profile.tagsForProgram(programKey(program)).map(t => t.name) }; }
  async prepareImport(program, existingPrograms) {
    const key = programKey(program);
    if (existingPrograms.some(p => programKey(p) === key)) throw Error('A Program with this ID already exists. Give this import a unique id.');
    const labels = normalizeTags(program.userTags ?? program.tags).filter(label => !this.profile.adminKeys.has(tagKey(label)));
    const next = this.profile.fork(); const ids = labels.map(name => next.tags.find(t => tagKey(t.name) === tagKey(name))?.id || next.createTag(name).id);
    if (ids.length) { next.setProgramTags(key, ids); await this.persist(next); }
    const result = { ...program, tags: [] }; delete result.userTags;
    return result;
  }
}
