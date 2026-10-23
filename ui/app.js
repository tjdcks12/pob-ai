import { LOCALES, locale, setLocale, t } from './i18n.js';

const $ = id => document.getElementById(id);
const store = {
  get: (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
};
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg class="p-icon"><use href="icons.svg#i-${name}"/></svg>`;

// The service hands the panel its token once in the URL; keep it for this window only.
const params = new URLSearchParams(location.search);
if (params.get('token')) { sessionStorage.setItem('pobai.token', params.get('token')); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('pobai.token') ?? '';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const request = async (method, path, body) => {
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return response.json().catch(() => ({ ok: false, error: { code: 'ERROR' } }));
};
const api = (path, body) => request(body === undefined ? 'GET' : 'POST', path, body);
const run = (command, args = {}) => api('/api/run', { command, args, lang: locale() });

const state = {
  live: false, update: null, providers: [], provider: store.get('pobai.provider', ''), models: {},
  tabs: [], active: null, attachments: [], pickerChoice: null,
};

// ---------- themes ----------
// pob = Path of Building's own look, dark/light = poe2way style. Older saved names map onto these.
const THEMES = ['pob', 'dark', 'light'];
const THEME_NAMES = { pob: 'themePob', dark: 'themeDark', light: 'themeLight' };
const migrateTheme = id => ({ default: 'pob', ember: 'dark', vaal: 'dark', midnight: 'dark', parchment: 'light' }[id] ?? (THEMES.includes(id) ? id : 'dark'));
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  store.set('pobai.theme', id);
}
function renderThemeCards() {
  const current = document.documentElement.dataset.theme;
  $('theme-cards').innerHTML = THEMES.map(id => `<label class="theme-card" data-theme="${id}">
    <input type="radio" name="panel-theme" value="${id}" ${id === current ? 'checked' : ''}>
    <span class="theme-preview"><span class="theme-lines"><i></i><i></i></span><b></b></span>
    <span class="theme-name">${escapeHtml(t(THEME_NAMES[id]))}</span></label>`).join('');
  $('theme-cards').querySelectorAll('input').forEach(input => input.addEventListener('change', () => setTheme(input.value)));
  $('window-theme').innerHTML = THEMES.map(id => `<option value="${id}">${escapeHtml(t(THEME_NAMES[id]))}</option>`).join('');
  $('window-theme').value = state.windowTheme ?? 'dark';
}
setTheme(migrateTheme(store.get('pobai.theme', 'dark')));

// ---------- language ----------
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-title]').forEach(el => { el.title = t(el.dataset.title); el.setAttribute('aria-label', t(el.dataset.title)); });
  document.querySelectorAll('[data-placeholder]').forEach(el => { el.placeholder = t(el.dataset.placeholder); });
  document.querySelectorAll('[data-suggest]').forEach(el => { el.textContent = t(el.dataset.suggest); });
  renderThemeCards();
  renderStatus();
  refreshBuild();
  showUpdate(state.update);
  renderAgents();
  renderTabs();
  renderModelLabel();
  for (const tab of state.tabs) for (const view of tab.views) renderAssistant(view);
}
$('locale').innerHTML = Object.entries(LOCALES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
$('locale').value = locale();
$('locale').addEventListener('change', e => { setLocale(e.target.value); applyI18n(); });
setLocale(locale());

// ---------- dialogs ----------
function openModal(dialog, focus) {
  const previous = document.activeElement;
  const close = () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  dialog.oncancel = e => { e.preventDefault(); close(); };
  dialog.onclick = e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  };
  dialog.querySelector('[data-close]').onclick = close;
  if (!dialog.open) dialog.showModal();
  focus?.focus();
}
$('open-settings').addEventListener('click', () => { loadProviders(); openModal($('settings-dialog')); });
$('open-history').addEventListener('click', () => { loadHistory(); openModal($('history-dialog')); });

// ---------- PoB status & build card ----------
function renderStatus() {
  const pill = $('pob-status');
  pill.className = `status-pill ${state.live ? 'on' : 'off'}`;
  pill.querySelector('.label').textContent = state.live ? t('connected') : `${t('disconnected')} · ${t('openPob')}`;
}
// Opening PoB can fail (PoB not found, not started); say why instead of doing nothing.
async function openPob() {
  const pill = $('pob-status');
  pill.disabled = true;
  pill.querySelector('.label').textContent = t('opening');
  const reply = await run('open').catch(error => ({ ok: false, error: { message: error.message } }));
  pill.disabled = false;
  renderStatus();
  if (!reply.ok) showPobProblem(reply.error);
}
function showPobProblem(error) {
  if (error?.code === 'POB_NOT_FOUND') {
    showNotice(t('pobNotFound'));
    openModal($('settings-dialog'), $('pob-path'));
  } else showNotice(`${t('error')}: ${error?.message ?? ''}`);
}
$('pob-status').addEventListener('click', () => { if (!state.live) openPob(); });

const fmt = value => typeof value === 'number' ? value.toLocaleString(locale(), { maximumFractionDigits: value < 100 ? 1 : 0 }) : (value ?? '–');
async function refreshBuild() {
  const reply = await run('build.summary').catch(() => null);
  const summary = reply?.ok ? reply.result : null;
  if (!summary?.loaded) {
    $('build-name').textContent = t('noBuild');
    $('build-sub').textContent = '';
    $('build-stats').innerHTML = '';
    return;
  }
  $('build-name').textContent = summary.name || 'Build';
  const loc = key => summary[`${key}_${locale()}`] ?? summary[key];
  $('build-sub').textContent = [loc('ascendancy') || loc('class'), `${t('level')} ${summary.level}`, summary.mainSkill && `${t('mainSkill')}: ${loc('mainSkill')}`].filter(Boolean).join(' · ');
  const s = summary.stats ?? {};
  const dps = s.FullDPS || s.CombinedDPS || s.TotalDPS || s['Minion.CombinedDPS'] || s['Minion.TotalDPS'];
  const cells = [['dps', dps], ['life', s.Life], ['es', s.EnergyShield], ['ehp', s.TotalEHP]];
  $('build-stats').innerHTML = cells.filter(([, v]) => v !== undefined).map(([k, v]) => `<div><dt>${escapeHtml(t(k))}</dt><dd>${fmt(v)}</dd></div>`).join('');
}

function listenEvents() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('pob', e => { state.live = JSON.parse(e.data).connected; renderStatus(); refreshBuild(); });
  source.addEventListener('build-changed', () => refreshBuild());
  source.addEventListener('update', e => showUpdate(JSON.parse(e.data)));
  source.addEventListener('focus-panel', () => { window.focus(); $('input').focus(); });
}

function showNotice(text) {
  const note = document.createElement('div');
  note.className = 'notice';
  note.textContent = text;
  $('chat').prepend(note);
}

// ---------- PoB window settings & PoB AI updates ----------
$('window-language').innerHTML = Object.entries(LOCALES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
$('window-language').addEventListener('change', e => run('ui.language', { language: e.target.value }));
$('window-theme').addEventListener('change', e => { state.windowTheme = e.target.value; run('ui.theme', { theme: e.target.value }); });
$('title-bar').addEventListener('change', e => run('ui.title_bar', { style: e.target.checked ? 'custom' : 'windows' }));
function showUpdate(update) {
  state.update = update?.available ? update : null;
  $('update-banner').hidden = !state.update;
  if (state.update) $('update-text').textContent = t('updateAvailable', { version: state.update.latest });
}
$('update-now').addEventListener('click', async () => {
  $('update-now').disabled = true;
  $('update-text').textContent = t('updating');
  const reply = await run('update.apply', { restart: true });
  if (!reply.ok) { $('update-now').disabled = false; showUpdate(state.update); showNotice(`${t('error')}: ${reply.error?.message ?? ''}`); }
});
async function usePob(args, busyLabel) {
  for (const id of ['pob-path-apply', 'pob-install']) $(id).disabled = true;
  if (busyLabel) $('pob-status').querySelector('.label').textContent = busyLabel;
  const reply = await run('setup', args).catch(error => ({ ok: false, error: { message: error.message } }));
  for (const id of ['pob-path-apply', 'pob-install']) $(id).disabled = false;
  renderStatus();
  if (!reply.ok) return showNotice(reply.error?.code === 'POB_NOT_FOUND' && args.pobPath ? t('pobFolderInvalid') : `${t('error')}: ${reply.error?.message ?? ''}`);
  $('pob-path').value = reply.result?.dir ?? '';
  $('chat').querySelectorAll('.notice').forEach(el => el.remove());
  openPob();
}
$('pob-path-apply').addEventListener('click', () => { const dir = $('pob-path').value.trim(); if (dir) usePob({ pobPath: dir }); });
$('pob-install').addEventListener('click', () => usePob({ installPob: true }, t('installingPob')));
async function loadStatus() {
  const reply = await api('/api/status').catch(() => null);
  if (!reply?.ok) return;
  $('pob-path').value = reply.pob?.dir ?? '';
  $('window-language').value = reply.settings?.pobLanguage ?? 'en';
  state.windowTheme = migrateTheme(reply.settings?.pobTheme || 'dark');
  $('window-theme').value = state.windowTheme;
  $('title-bar').checked = reply.settings?.pobTitleBar !== 'windows';
  showUpdate(reply.update);
}

// ---------- agents ----------
const providerById = id => state.providers.find(p => p.id === id);
const providerName = id => providerById(id)?.label ?? id;
const mark = id => `<span class="agent-provider-mark"><img src="agents/${encodeURIComponent(id)}.svg" alt=""></span>`;

async function loadProviders() {
  const reply = await api('/api/agent/providers').catch(() => ({ providers: [] }));
  state.providers = reply.providers ?? [];
  const available = state.providers.filter(p => p.available);
  if (!providerById(state.provider)?.available) state.provider = available[0]?.id ?? state.providers[0]?.id ?? '';
  state.loadedProviders = true;
  renderAgents();
  renderModelLabel();
}
function chooseProvider(id) {
  state.provider = id;
  store.set('pobai.provider', id);
  renderAgents();
  renderModelLabel();
}
async function pickPath(id) {
  const reply = await api(`/api/agent/providers/${id}/pick`, { title: t('chooseExecutable', { agent: providerName(id) }) });
  if (!reply.ok) showNotice(reply.error?.code === 'AGENT_PATH_INVALID' ? t('errPathInvalid', { agent: providerName(id) }) : t('errNotRunnable'));
  await loadProviders();
}

/** The agent picker (poe2way AgentPicker): provider cards, and on the popover a start button. */
function pickerHtml(popover) {
  if (!state.loadedProviders) return `<p class="agent-chat-progress"><span class="spinner"></span>${escapeHtml(t('checkingAgents'))}</p>`;
  if (!state.providers.length) return `<p class="agent-picker-note"><span>${escapeHtml(t('noAgent'))}</span></p>`;
  const chosen = providerById(state.provider);
  const cards = state.providers.map(p => `<button type="button" role="radio" aria-checked="${p.id === state.provider}" data-provider="${p.id}">
      ${mark(p.id)}<span class="agent-provider-label"><strong>${escapeHtml(p.label)}</strong>
      <small class="${p.available ? 'ok' : ''}">${escapeHtml(t(p.available ? 'agentAvailable' : 'agentNeedsPath'))}</small></span>
      ${p.id === state.provider ? `<span class="agent-provider-check">${icon('check')}</span>` : ''}</button>`).join('');
  const note = chosen && !chosen.available
    ? `<p class="agent-picker-note"><span>${escapeHtml(t('chooseExecutable', { agent: chosen.label }))}</span><button type="button" data-pick="${chosen.id}">${icon('folder-open')}${escapeHtml(t('choosePath'))}</button></p>` : '';
  const actions = popover
    ? `<button type="button" class="agent-primary agent-start" data-start ${chosen?.available ? '' : 'disabled'}>${escapeHtml(t('startWith', { agent: chosen?.label ?? '' }))}</button>
       <button type="button" class="agent-quiet" data-resume>${icon('history')}${escapeHtml(t('resumePrevious'))}</button>` : '';
  return `<div class="agent-picker"><h3>${escapeHtml(t(popover ? 'newChat' : 'chooseAgent'))}</h3>
    <div class="agent-provider-grid" role="radiogroup" aria-label="${escapeHtml(t('chooseAgent'))}">${cards}</div>${note}${actions}</div>`;
}
function wirePicker(root) {
  const cards = [...root.querySelectorAll('[data-provider]')];
  cards.forEach((card, i) => {
    card.addEventListener('click', () => chooseProvider(card.dataset.provider));
    card.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = cards[(i + step + cards.length) % cards.length];
      chooseProvider(next.dataset.provider);
      root.querySelector(`[data-provider="${next.dataset.provider}"]`)?.focus();
    });
  });
  root.querySelector('[data-pick]')?.addEventListener('click', e => pickPath(e.currentTarget.dataset.pick));
  root.querySelector('[data-start]')?.addEventListener('click', () => { closePopovers(); newTab(state.provider); $('input').focus(); });
  root.querySelector('[data-resume]')?.addEventListener('click', () => { closePopovers(); loadHistory(); openModal($('history-dialog')); });
}
function renderAgents() {
  $('picker-inline').innerHTML = pickerHtml(false);
  wirePicker($('picker-inline'));
  if (!$('picker-popover').hidden) { $('picker-popover').innerHTML = pickerHtml(true); wirePicker($('picker-popover')); }
  $('agent-rows').innerHTML = state.providers.map(p => {
    const where = p.command ? `${t({ custom: 'pathCustom', env: 'pathEnv', auto: 'pathAuto' }[p.source] ?? 'pathAuto')} · ${p.command}` : t('agentNeedsPath');
    return `<div class="agent-row">${mark(p.id)}<div><div class="set-title">${escapeHtml(p.label)}</div>
      <p class="set-desc" title="${escapeHtml(p.command ?? '')}">${escapeHtml(p.available ? where : (p.command ? `${t('pathMissing')} · ${p.command}` : where))}</p></div>
      <div class="set-actions"><button type="button" data-pick="${p.id}">${icon('folder-open')}${escapeHtml(t(p.command ? 'changePath' : 'choosePath'))}</button>
      ${p.source === 'custom' ? `<button type="button" class="agent-quiet" data-auto="${p.id}">${icon('refresh-cw')}${escapeHtml(t('autoDetect'))}</button>` : ''}
      ${p.available ? `<button type="button" class="agent-quiet" data-login="${p.id}">${icon('log-in')}${escapeHtml(t('signIn'))}</button>` : ''}</div></div>`;
  }).join('');
  $('agent-rows').querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pickPath(b.dataset.pick)));
  $('agent-rows').querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', async () => { await request('DELETE', `/api/agent/providers/${b.dataset.auto}/path`); loadProviders(); }));
  $('agent-rows').querySelectorAll('[data-login]').forEach(b => b.addEventListener('click', () => api(`/api/agent/providers/${b.dataset.login}/login`, {})));
}

// ---------- popovers ----------
function closePopovers() {
  $('picker-popover').hidden = true;
  $('model-popover').hidden = true;
  $('new-chat').setAttribute('aria-expanded', 'false');
  $('model-button').setAttribute('aria-expanded', 'false');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopovers(); });
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#picker-popover, #new-chat, #model-popover, #model-button')) closePopovers();
});
$('new-chat').addEventListener('click', () => {
  if (!state.tabs.length) { activate(null); $('input').focus(); return; }
  const open = $('picker-popover').hidden;
  closePopovers();
  if (!open) return;
  $('picker-popover').hidden = false;
  $('new-chat').setAttribute('aria-expanded', 'true');
  renderAgents();
  $('picker-popover').querySelector('[aria-checked=true]')?.focus();
});

// ---------- model and effort ----------
const EFFORT_NAMES = { minimal: 'effortMinimal', low: 'effortLow', medium: 'effortMedium', high: 'effortHigh', xhigh: 'effortXhigh', max: 'effortMax' };
const effortName = id => EFFORT_NAMES[id] ? t(EFFORT_NAMES[id]) : id;
async function models(provider) {
  if (!provider) return { models: [], defaultEffort: 'medium' };
  state.models[provider] ??= api(`/api/agent/providers/${provider}/models`).then(r => (r.ok ? r : { models: [], defaultEffort: 'medium' }));
  return state.models[provider];
}
/** Model/effort for the active tab, or the remembered choice for a new chat with the chosen agent. */
function currentChoice() {
  const tab = activeTab();
  if (tab) return { provider: tab.provider, model: tab.model ?? null, effort: tab.effort ?? null };
  const provider = state.provider;
  return { provider, model: store.get(`pobai.model.${provider}`, '') || null, effort: store.get(`pobai.effort.${provider}`, '') || null };
}
function setChoice(model, effort) {
  const tab = activeTab();
  if (tab) { tab.model = model; tab.effort = effort; tab.choiceChanged = true; }
  else { store.set(`pobai.model.${state.provider}`, model ?? ''); store.set(`pobai.effort.${state.provider}`, effort ?? ''); }
  renderModelLabel();
}
async function renderModelLabel() {
  const { provider, model, effort } = currentChoice();
  const catalog = await models(provider);
  const name = catalog.models.find(m => m.id === model)?.name ?? (model || t('modelDefault'));
  $('model-label').textContent = `${name} · ${effortName(effort ?? catalog.defaultEffort ?? 'medium')}`;
  $('model-button').title = `${t('model')} · ${t('effort')}`;
}
$('model-button').addEventListener('click', async () => {
  const open = $('model-popover').hidden;
  closePopovers();
  if (!open) return;
  const { provider, model, effort } = currentChoice();
  const catalog = await models(provider);
  const selected = catalog.models.find(m => m.id === model);
  const efforts = selected?.efforts?.length ? selected.efforts : ['low', 'medium', 'high'];
  const popover = $('model-popover');
  popover.innerHTML = `<label>${escapeHtml(t('model'))}<select id="model-select"><option value="">${escapeHtml(t('modelDefault'))}</option>
      ${catalog.models.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === model ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select></label>
    <label>${escapeHtml(t('effort'))}<select id="effort-select">${efforts.map(e => `<option value="${escapeHtml(e)}" ${(effort ?? selected?.defaultEffort ?? catalog.defaultEffort) === e ? 'selected' : ''}>${escapeHtml(effortName(e))}</option>`).join('')}</select></label>
    <p>${escapeHtml(t('modelNote'))}</p>`;
  popover.hidden = false;
  $('model-button').setAttribute('aria-expanded', 'true');
  const apply = () => setChoice($('model-select').value || null, $('effort-select').value || null);
  $('model-select').addEventListener('change', () => { apply(); closePopovers(); $('model-button').click(); });
  $('effort-select').addEventListener('change', apply);
});

// ---------- images ----------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function addImages(files) {
  for (const file of files) {
    if (state.attachments.length >= 4) { showNotice(t('imageTooMany')); break; }
    if (!IMAGE_TYPES.includes(file.type)) { showNotice(t('imageInvalid')); continue; }
    if (file.size > 5 * 1024 * 1024) { showNotice(t('imageTooLarge')); continue; }
    const reader = new FileReader();
    reader.onload = () => { state.attachments.push({ name: file.name || 'image', dataUrl: reader.result }); renderAttachments(); };
    reader.readAsDataURL(file);
  }
}
function renderAttachments() {
  const box = $('attachments');
  box.hidden = !state.attachments.length;
  box.innerHTML = state.attachments.map((a, i) => `<span class="attachment"><img src="${a.dataUrl}" alt="${escapeHtml(a.name)}">
    <button type="button" data-remove="${i}" title="${escapeHtml(t('removeImage'))}" aria-label="${escapeHtml(t('removeImage'))}">${icon('x')}</button></span>`).join('');
  box.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { state.attachments.splice(Number(b.dataset.remove), 1); renderAttachments(); }));
}
$('attach').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => { addImages([...e.target.files]); e.target.value = ''; });
$('input').addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addImages(files); }
});
$('composer').addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('composer').classList.add('dragging'); } });
$('composer').addEventListener('dragleave', () => $('composer').classList.remove('dragging'));
$('composer').addEventListener('drop', e => { e.preventDefault(); $('composer').classList.remove('dragging'); addImages([...e.dataTransfer.files]); });

// ---------- markdown (safe subset) ----------
const inline = s => escapeHtml(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
function markdown(text) {
  const out = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    } else if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const head = cells(line); i++;
      const rows = [];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [line];
      while (i + 1 < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) items.push(lines[++i]);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(it => `<li>${inline(it.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^>\s?/.test(line)) {
      const quote = [line];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) quote.push(lines[++i]);
      out.push(`<blockquote>${quote.map(q => inline(q.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`);
    } else if (/^#{1,4}\s/.test(line)) out.push(`<h3>${inline(line.replace(/^#+\s/, ''))}</h3>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
}

// ---------- conversation tabs ----------
// A tab is one chat: { key, sessionId, provider, title, model, effort, running, pane, views }.
let nextKey = 1;
const activeTab = () => state.tabs.find(tab => tab.key === state.active) ?? null;
function saveTabs() {
  store.set('pobai.tabs', JSON.stringify(state.tabs.filter(tab => tab.sessionId).map(tab => tab.sessionId)));
  store.set('pobai.activeTab', activeTab()?.sessionId ?? '');
}
function newTab(provider, session = {}) {
  const pane = document.createElement('div');
  pane.className = 'chat-pane';
  $('chat').append(pane);
  const tab = { key: nextKey++, sessionId: session.id ?? null, provider: session.provider ?? provider, title: session.title ?? '',
    model: session.model ?? null, effort: session.effort ?? null, running: false, pane, views: [] };
  if (!session.id) { tab.model = currentChoice().model; tab.effort = currentChoice().effort; }
  state.tabs.push(tab);
  activate(tab.key);
  return tab;
}
function activate(key) {
  state.active = key;
  for (const tab of state.tabs) tab.pane.hidden = tab.key !== key;
  updateEmpty();
  renderTabs();
  renderModelLabel();
  renderSend();
  saveTabs();
}
function updateEmpty() {
  const tab = activeTab();
  $('empty').hidden = Boolean(tab && tab.pane.childElementCount);
}
function closeTab(key) {
  const index = state.tabs.findIndex(tab => tab.key === key);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  tab.pane.remove();
  if (state.active === key) activate(state.tabs[Math.min(index, state.tabs.length - 1)]?.key ?? null);
  else { renderTabs(); saveTabs(); }
}
function renderTabs() {
  const nav = $('sessions');
  nav.hidden = !state.tabs.length;
  nav.innerHTML = state.tabs.map((tab, i) => `<div class="agent-session-tab" data-active="${tab.key === state.active}">
      <button type="button" role="tab" aria-selected="${tab.key === state.active}" data-tab="${tab.key}" title="${escapeHtml(tab.title || providerName(tab.provider))}">
        ${mark(tab.provider)}<span>${escapeHtml(providerName(tab.provider))} ${i + 1}</span><span class="agent-dot ${tab.running ? 'on' : ''}"></span></button>
      <button type="button" class="agent-session-close" data-close-tab="${tab.key}" title="${escapeHtml(t('closeChat'))}" aria-label="${escapeHtml(t('closeChat'))}">${icon('x')}</button></div>`).join('');
  nav.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => activate(Number(b.dataset.tab))));
  nav.querySelectorAll('[data-close-tab]').forEach(b => b.addEventListener('click', () => closeTab(Number(b.dataset.closeTab))));
}

// ---------- messages ----------
// Stay at the bottom only when the reader already was there (poe2way AgentConversation).
function keepScroll(update) {
  const chat = $('chat');
  const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 64;
  update();
  if (stick) chat.scrollTop = chat.scrollHeight;
}
function addUser(tab, text, images = []) {
  keepScroll(() => {
    const el = document.createElement('article');
    el.className = 'agent-message user';
    el.innerHTML = `<div class="agent-message-who">${escapeHtml(t('you'))}</div><div class="agent-message-body"></div>`;
    el.querySelector('.agent-message-body').textContent = text;
    if (images.length) {
      const box = document.createElement('div');
      box.className = 'message-images';
      for (const image of images) box.append(Object.assign(document.createElement('img'), { src: image.src, alt: image.name ?? '' }));
      el.append(box);
    }
    tab.pane.append(el);
    updateEmpty();
  });
}
function addAssistant(tab) {
  const el = document.createElement('article');
  el.className = 'agent-message assistant';
  tab.pane.append(el);
  const view = { el, tab, texts: new Map(), phase: null, working: true, error: null, interrupted: false };
  tab.views.push(view);
  updateEmpty();
  return view;
}
const PHASES = { inspect: 'phaseInspect', calculate: 'phaseCalculate', lookup: 'phaseLookup', compare: 'phaseCompare', import: 'phaseImport',
  apply: 'phaseApply', show: 'phaseShow', writing: 'phaseWriting', stopping: 'phaseStopping' };
const ERRORS = {
  AGENT_MISSING: ['errMissing', 'pick'], AGENT_NOT_RUNNABLE: ['errNotRunnable', 'pick'], AGENT_SIGNED_OUT: ['errSignedOut', 'login'],
  AGENT_FAILED: ['errFailed', 'retry'], BUSY: ['errBusy'], AGENT_PATH_INVALID: ['errPathInvalid', 'pick'],
  IMAGE_TOO_MANY: ['imageTooMany'], IMAGE_TOO_LARGE: ['imageTooLarge'], IMAGE_INVALID: ['imageInvalid'], IMAGE_QUOTA: ['imageTooLarge'],
};
function renderAssistant(view) {
  const { tab } = view;
  const agent = providerName(tab.provider);
  const text = [...view.texts.values()].join('\n\n');
  const [errorKey, action] = view.error ? ERRORS[view.error] ?? ['error'] : [];
  const actionLabel = { pick: 'choosePath', login: 'signIn', retry: 'retry' }[action];
  keepScroll(() => {
    view.el.innerHTML = `<div class="agent-message-who">${mark(tab.provider)}${escapeHtml(agent)}${view.interrupted ? `<span class="tag">${escapeHtml(t('interrupted'))}</span>` : ''}</div>
      <div class="agent-message-body">${markdown(text)}</div>
      ${view.working ? `<div class="agent-chat-progress"><span class="spinner"></span>${escapeHtml(t(PHASES[view.phase] ?? 'thinking'))}</div>` : ''}
      ${view.error ? `<div class="agent-error"><span>${escapeHtml(t(errorKey, { agent }))}</span>${actionLabel ? `<button type="button" data-action="${action}">${escapeHtml(t(actionLabel))}</button>` : ''}</div>` : ''}`;
    view.el.querySelector('[data-action]')?.addEventListener('click', () => {
      if (action === 'pick') pickPath(tab.provider);
      if (action === 'login') api(`/api/agent/providers/${tab.provider}/login`, {});
      if (action === 'retry' && view.retry) send(view.retry.text, view.retry.images, tab);
    });
  });
}

/** Reads the chat event stream into a view (POST /api/agent/chat and GET .../stream). */
async function readStream(response, tab, view) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      const data = frame.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.type === 'start') { tab.sessionId = event.sessionId ?? tab.sessionId; saveTabs(); }
      if (event.type === 'phase') view.phase = event.phase;
      if (event.type === 'text') view.texts.set(event.id, event.partial ? (view.texts.get(event.id) ?? '') + event.text : event.text);
      if (event.type === 'error') view.error = event.code;
      if (event.type === 'end') { view.interrupted = event.delivery === 'interrupted'; tab.sessionId = event.sessionId ?? tab.sessionId; }
      renderAssistant(view);
    }
  }
}

function renderSend() {
  const running = Boolean(activeTab()?.running);
  const button = $('send');
  button.classList.toggle('stop', running);
  button.innerHTML = icon(running ? 'square' : 'arrow-up');
  button.title = t(running ? 'stopResponse' : 'send');
  button.setAttribute('aria-label', button.title);
}

async function send(text, images = state.attachments, target = activeTab()) {
  if (!text.trim() && !images.length) return;
  let tab = target;
  if (!tab) {
    if (!providerById(state.provider)?.available) { renderAgents(); return; }
    tab = newTab(state.provider);
  }
  if (tab.running) return;
  if (!tab.title) tab.title = (text.trim() || images[0]?.name || '').slice(0, 60);
  addUser(tab, text, images.map(a => ({ src: a.dataUrl, name: a.name })));
  const view = addAssistant(tab);
  view.retry = { text, images };
  renderAssistant(view);
  tab.running = true;
  renderTabs(); renderSend();
  const body = { sessionId: tab.sessionId, provider: tab.provider, message: text, locale: locale(), images: images.length ? images : undefined };
  if (!tab.sessionId || tab.choiceChanged) { body.model = tab.model; body.effort = tab.effort; tab.choiceChanged = false; }
  if (images === state.attachments) { state.attachments = []; renderAttachments(); }
  try {
    const response = await fetch('/api/agent/chat', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok || !response.body) view.error = (await response.json().catch(() => ({}))).error?.code ?? 'AGENT_FAILED';
    else await readStream(response, tab, view);
  } catch {
    view.error ??= 'AGENT_FAILED';
  } finally {
    view.working = false;
    tab.running = false;
    renderAssistant(view);
    renderTabs(); renderSend(); saveTabs();
  }
}

$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  const tab = activeTab();
  if (tab?.running) {
    const view = tab.views.at(-1);
    if (view) { view.phase = 'stopping'; renderAssistant(view); }
    await api('/api/agent/stop', { sessionId: tab.sessionId });
    return;
  }
  const text = $('input').value;
  $('input').value = '';
  autosize();
  send(text);
});
const autosize = () => { const el = $('input'); el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; };
$('input').addEventListener('input', autosize);
$('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); $('composer').requestSubmit(); }
});
document.querySelectorAll('[data-suggest]').forEach(el => el.addEventListener('click', () => {
  $('input').value = t(el.dataset.suggest); autosize(); $('input').focus();
}));

// ---------- saved chats ----------
/** Opens a saved chat in a tab (or focuses its tab) and follows its turn if one is running. */
async function openChat(id) {
  const open = state.tabs.find(tab => tab.sessionId === id);
  if (open) return activate(open.key);
  const reply = await api(`/api/agent/sessions/${id}`);
  if (!reply.ok) return;
  const session = reply.session;
  const tab = newTab(session.provider, session);
  for (const m of session.messages) {
    if (m.role === 'user') {
      addUser(tab, m.text, (m.images ?? []).map(image => ({ name: image.name, src: `/api/agent/sessions/${id}/images/${image.id}?token=${encodeURIComponent(token)}` })));
    } else {
      const view = addAssistant(tab);
      view.texts.set('saved', m.text ?? '');
      view.working = false;
      view.error = m.error ?? null;
      view.interrupted = m.delivery === 'interrupted';
      renderAssistant(view);
    }
  }
  if (session.running) follow(tab);
}
async function follow(tab) {
  const view = addAssistant(tab);
  tab.running = true;
  renderTabs(); renderSend();
  try {
    const response = await fetch(`/api/agent/sessions/${tab.sessionId}/stream`, { headers });
    if (response.ok && response.body) await readStream(response, tab, view);
  } finally {
    view.working = false;
    tab.running = false;
    if (!view.texts.size && !view.error) { view.el.remove(); tab.views.pop(); }
    else renderAssistant(view);
    renderTabs(); renderSend();
  }
}
async function loadHistory() {
  const reply = await api('/api/agent/sessions').catch(() => ({ sessions: [] }));
  const list = $('history-list');
  const sessions = (reply.sessions ?? []).slice().reverse();
  if (!sessions.length) { list.innerHTML = `<li class="history-empty">${escapeHtml(t('noHistory'))}</li>`; return; }
  list.innerHTML = sessions.map(s => `<li>
      <button type="button" class="open" data-open="${s.id}">${mark(s.provider)}<span class="title">${escapeHtml(s.title || providerName(s.provider))}</span>
        <span class="date">${escapeHtml(new Date(s.updatedAt ?? s.createdAt).toLocaleDateString(locale()))}</span></button>
      <button type="button" class="agent-icon del" data-delete="${s.id}" title="${escapeHtml(t('deleteChat'))}" aria-label="${escapeHtml(t('deleteChat'))}">${icon('trash-2')}</button></li>`).join('');
  list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { $('history-dialog').close(); openChat(b.dataset.open); }));
  // Deleting takes a second click within three seconds (poe2way's "click again to remove").
  list.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
    if (!b.hasAttribute('data-armed')) {
      b.setAttribute('data-armed', '');
      b.title = t('confirmDelete');
      setTimeout(() => { b.removeAttribute('data-armed'); b.title = t('deleteChat'); }, 3000);
      return;
    }
    await request('DELETE', `/api/agent/sessions/${b.dataset.delete}`);
    const tab = state.tabs.find(x => x.sessionId === b.dataset.delete);
    if (tab) closeTab(tab.key);
    loadHistory();
  }));
}
async function restoreTabs() {
  let ids = [];
  try { ids = JSON.parse(store.get('pobai.tabs', '[]')); } catch { /* ignore */ }
  const active = store.get('pobai.activeTab', '');
  for (const id of ids) await openChat(id);
  const tab = state.tabs.find(x => x.sessionId === active);
  if (tab) activate(tab.key); else updateEmpty();
}

applyI18n();
loadProviders().then(restoreTabs);
loadStatus();
listenEvents();
