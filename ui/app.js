import { LOCALES, locale, localePreference, systemLocale, setLocale, t } from './i18n.js';
import { refreshWindowChrome, setPobWindow } from './window.js';
import { THEMES, THEME_NAMES, resolveTheme } from './themes.js';
import { normalizeLocalePreference } from './locale.js';
import { characterSyncSettings } from './character-sync.js';
import { updatePresentation } from './updates.js';

const $ = id => document.getElementById(id);
const store = {
  get: (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
};
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg class="p-icon"><use href="icons.svg#i-${name}"/></svg>`;

// The service hands the panel its token once in the URL; keep it for this window only.
const params = new URLSearchParams(location.search);
const settingsView = params.get('view') === 'settings';
document.documentElement.dataset.view = settingsView ? 'settings' : 'agent';
if (settingsView) {
  document.body.append($('settings-template').content.cloneNode(true));
  $('settings-dialog').querySelector('.p-dialog-body').prepend($('connection-banner'));
  document.querySelector('.agent-brand h1').setAttribute('data-i18n', 'settings');
}
if (params.get('token')) {
  sessionStorage.setItem('pobai.token', params.get('token'));
  params.delete('token');
  history.replaceState(null, '', location.pathname + (params.size ? '?' + params : ''));
}
const token = sessionStorage.getItem('pobai.token') ?? '';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const request = async (method, path, body) => {
  try {
    const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return await response.json();
  } catch {
    setConnectionLost(true);
    return { ok: false, error: { code: 'SERVICE_DISCONNECTED' } };
  }
};
const api = (path, body) => request(body === undefined ? 'GET' : 'POST', path, body);
const run = (command, args = {}) => api('/api/run', { command, args, lang: locale() });
const characterSync = settingsView ? characterSyncSettings({ api, t, locale }) : null;

const state = {
  live: false, pobMissing: false, installingPob: false, update: null, autoDownloadUpdates: true, appVersion: '', providers: [], provider: store.get('pobai.provider', ''), models: {},
  tabs: [], active: null, attachments: [], idle: { draft: '', attachments: [], fullAccess: false }, picker: { fullAccess: false },
};

// ---------- themes ----------
// The service's remembered PoB theme is shared by every panel and the PoB window.
function setTheme(id) {
  state.theme = resolveTheme(id);
  document.documentElement.dataset.theme = state.theme;
  refreshWindowChrome();
}
function renderThemeCards() {
  if (!settingsView) return;
  $('theme-cards').innerHTML = THEMES.map(id => `<label class="theme-card" data-theme="${id}">
    <input type="radio" name="theme" value="${id}" ${id === state.theme ? 'checked' : ''}>
    <span class="theme-preview" aria-hidden="true"><span class="preview-nav"></span><span class="preview-sheet"><i></i><i></i><i></i></span></span>
    <span class="theme-name">${escapeHtml(t(THEME_NAMES[id]))}</span></label>`).join('');
  $('theme-cards').querySelectorAll('input').forEach(input => input.addEventListener('change', async () => {
    const reply = await run('ui.theme', { theme: input.value }).catch(error => ({ ok: false, error }));
    if (reply.ok) setTheme(reply.result.theme);
    else showNotice(t('settingFailed'), { container: $('theme-cards').parentElement });
    renderThemeCards();
  }));
}
setTheme(document.documentElement.dataset.theme);

// ---------- language ----------
function renderLocaleOptions() {
  if (!settingsView) return;
  const options = `<option value="system">${escapeHtml(t('systemLanguage'))} (${LOCALES[systemLocale()]})</option>`
    + Object.entries(LOCALES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
  $('locale').innerHTML = options;
  $('locale').value = localePreference();
}
function applyI18n() {
  renderLocaleOptions();
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-title]').forEach(el => { el.title = t(el.dataset.title); el.setAttribute('aria-label', t(el.dataset.title)); });
  document.querySelectorAll('[data-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.label)));
  document.querySelectorAll('[data-placeholder]').forEach(el => { el.placeholder = t(el.dataset.placeholder); });
  document.querySelectorAll('[data-suggest]').forEach(el => { el.textContent = t(el.dataset.suggest); });
  document.querySelectorAll('[data-poe2way]').forEach(el => { el.href = `https://www.poe2way.com/${locale()}`; });
  renderThemeCards();
  characterSync?.render();
  refreshWindowChrome();
  renderStatus();
  renderPobSetup();
  if (settingsView) { document.title = 'PoB AI · ' + t('settings'); renderAgents(); showUpdate(state.update); return; }
  showUpdate(state.update);
  renderAgents();
  renderTabs();
  renderModelLabel();
  for (const tab of state.tabs) for (const view of tab.views) renderAssistant(view);
}
if (settingsView) {
  $('locale').addEventListener('change', async e => {
    const select = e.target;
    select.disabled = true;
    try {
      const reply = await run('ui.language', { language: select.value });
      if (!reply.ok) throw new Error(reply.error?.message ?? '');
      setLocale(reply.result.preference); applyI18n();
    } catch { renderLocaleOptions(); showNotice(t('settingFailed'), { container: select.closest('.set-section') }); }
    finally { select.disabled = false; }
  });
}
setLocale(localePreference());
window.addEventListener('storage', e => {
  if (e.key === 'pobai.providersChanged') { state.models = {}; loadProviders(); }
});

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
async function openSettings(focus) {
  const reply = await api('/api/settings/open', { focus });
  if (!reply.ok) showNotice(t('settingsOpenFailed'), { retry: () => openSettings(focus) });
}
$('open-history').addEventListener('click', () => { loadHistory(); openModal($('history-dialog')); });

// ---------- PoB connection ----------
function renderPobSetup() {
  const showSetup = !settingsView && !state.live && state.pobMissing;
  const provider = state.providers.find(p => p.id === state.provider);
  const needsAgent = !settingsView && !activeTab() && (!provider?.available || provider.signingIn || !['signed_in', 'unknown'].includes(provider.auth));
  $('pob-setup').hidden = !showSetup;
  $('composer').hidden = showSetup || needsAgent;
  $('empty').querySelector('h2').hidden = showSetup || needsAgent;
  $('empty').querySelector('.suggestions').hidden = showSetup || needsAgent;
  $('setup-install-pob').disabled = state.installingPob;
  $('setup-existing-pob').disabled = state.installingPob;
  $('setup-install-pob').textContent = t(state.installingPob ? 'installingPob' : 'installPob');
}
$('setup-existing-pob').addEventListener('click', () => openSettings('pob-path'));
$('setup-install-pob').addEventListener('click', async () => {
  if (state.installingPob) return;
  state.installingPob = true;
  $('pob-setup-status').hidden = true;
  renderPobSetup();
  try {
    const reply = await run('setup', { installPob: true });
    if (!reply.ok) throw new Error(reply.error?.message ?? t('error'));
    await loadStatus();
    await openPob();
  } catch (error) {
    $('pob-setup-status').textContent = t('pobInstallFailed');
    $('pob-setup-status').hidden = false;
  } finally {
    state.installingPob = false;
    renderPobSetup();
  }
});
function renderStatus() {
  const pill = $('pob-status');
  pill.setAttribute('aria-label', state.live ? t('connected') : state.pobMissing ? t('connectPob') : t('openPob'));
  pill.disabled = Boolean(state.openingPob);
  pill.className = `status-pill ${state.live ? 'on' : 'off'}`;
  pill.querySelector('.label').textContent = state.live ? t('connected') : state.openingPob ? t('opening') : state.pobMissing ? t('connectPob') : `${t('disconnected')} · ${t('openPob')}`;
}
// Opening PoB can fail (PoB not found, not started); say why instead of doing nothing.
async function openPob() {
  if (state.openingPob) return;
  state.openingPob = true;
  const pill = $('pob-status');
  pill.disabled = true;
  pill.querySelector('.label').textContent = t('opening');
  const reply = await run('open').catch(error => ({ ok: false, error: { message: error.message } }));
  if (!reply.ok) state.openingPob = false;
  else {
    clearTimeout(state.openingTimer);
    state.openingTimer = setTimeout(() => {
      state.openingPob = false; renderStatus();
      if (!state.live) showPobProblem({});
    }, 45000);
  }
  renderStatus();
  if (!reply.ok) showPobProblem(reply.error);
}
function showPobProblem(error) {
  if (error?.code === 'POB_NOT_FOUND') {
    state.pobMissing = true;
    renderPobSetup();
    if (settingsView) $('pob-path-status').textContent = t('pobFolderInvalid');
  } else if (settingsView) $('pob-path-status').textContent = t('pobOpenFailed');
  else showNotice(t('pobOpenFailed'), { retry: openPob, settings: true });
}
$('pob-status').addEventListener('click', () => {
  if (state.pobMissing) { $('pob-setup').scrollIntoView({ block: 'nearest' }); $('setup-install-pob').focus(); }
  else if (!state.live) openPob();
});

function listenEvents() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.onopen = () => {
    clearTimeout(state.connectionTimer);
    const reconnecting = state.connectionLost;
    setConnectionLost(false);
    if (reconnecting) { loadStatus(); loadProviders(); }
  };
  source.onerror = () => {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = setTimeout(() => setConnectionLost(true), 1500);
  };
  source.addEventListener('theme', e => { setTheme(JSON.parse(e.data).theme); renderThemeCards(); });
  source.addEventListener('language', e => { setLocale(JSON.parse(e.data).preference); applyI18n(); });
  source.addEventListener('pob-install', () => loadStatus());
  source.addEventListener('character-sync', e => characterSync?.update(JSON.parse(e.data)));
  source.addEventListener('update', e => showUpdate(JSON.parse(e.data)));
  source.addEventListener('update-preferences', e => { state.autoDownloadUpdates = JSON.parse(e.data).autoDownloadUpdates; renderUpdateSettings(); });
  source.addEventListener('pob', e => {
    const live = JSON.parse(e.data);
    setPobWindow(live);
    if (live.connected && !live.pid) loadStatus();
    state.live = live.connected;
    if (state.live) { state.pobMissing = false; state.openingPob = false; clearTimeout(state.openingTimer); }
    renderStatus(); renderPobSetup();
    if (settingsView) characterSync.load();
  });
  if (settingsView) return;
  source.addEventListener('focus-panel', () => {
    if (document.hasFocus()) $('input').focus({ preventScroll: true });
  });
}

function setConnectionLost(lost) {
  state.connectionLost = lost;
  $('connection-banner').hidden = !lost;
  $('reconnect').disabled = false;
}
$('reconnect').addEventListener('click', async () => {
  $('reconnect').disabled = true;
  if (window.chrome?.webview) window.chrome.webview.postMessage('service:reconnect');
  const reply = await api('/api/health');
  if (reply.ok) { setConnectionLost(false); loadStatus(); loadProviders(); }
  else $('reconnect').disabled = false;
});
function showNotice(text, { container, retry, settings } = {}) {
  if (state.connectionLost) return;
  const parent = container ?? (settingsView ? $('settings-dialog').querySelector('.p-dialog-body') : $('chat'));
  parent.querySelector(':scope > .notice')?.remove();
  const note = document.createElement('div');
  note.className = 'notice';
  note.setAttribute('role', 'status');
  note.textContent = text;
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = t('retry');
    button.onclick = () => { note.remove(); retry(); };
    note.append(button);
  }
  if (settings) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = t('connectExistingPob');
    button.onclick = () => openSettings('pob-path');
    note.append(button);
  }
  parent.append(note);
}

// ---------- PoB window settings & PoB AI updates ----------
function showUpdate(update) {
  state.update = update ?? null;
  const view = updatePresentation(state.update);
  $('update-banner').hidden = !view.visible;
  $('update-text').textContent = t(view.text, view.vars);
  $('update-now').textContent = t(view.action);
  $('update-now').disabled = view.busy;
  renderUpdateSettings();
}
function renderUpdateSettings() {
  if (!settingsView) return;
  const view = updatePresentation(state.update);
  $('auto-download-updates').checked = state.autoDownloadUpdates;
  $('check-updates').disabled = view.busy;
  $('update-check-status').textContent = (state.appVersion ? `v${state.appVersion} · ` : '') + t(view.text, view.vars);
}
if (settingsView) {
  $('auto-download-updates').addEventListener('change', async e => {
    const input = e.target;
    input.disabled = true;
    try {
      const reply = await run('update.automatic', { enabled: input.checked });
      if (!reply.ok) throw new Error();
      state.autoDownloadUpdates = reply.result.autoDownloadUpdates;
    } catch { showNotice(t('settingFailed'), { container: input.closest('.set-section') }); }
    finally { input.disabled = false; renderUpdateSettings(); }
  });
  $('check-updates').addEventListener('click', async () => {
    $('check-updates').disabled = true;
    $('update-check-status').textContent = t('checkingUpdates');
    const reply = await run('update.check').catch(() => null);
    if (reply?.ok) showUpdate(reply.result);
    else showUpdate({ ...state.update, phase: state.update?.restartNeeded ? 'ready' : 'checkError' });
  });
}
$('update-now').addEventListener('click', async () => {
  $('update-now').disabled = true;
  $('update-text').textContent = t('updating');
  const reply = await run('update.apply', { restart: true });
  if (!reply.ok) { $('update-now').disabled = false; $('update-text').textContent = t('updateFailed'); $('update-now').textContent = t('retry'); }
  else if (!window.chrome?.webview && reply.result?.restarting) {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const status = await api('/api/status').catch(() => null);
      if (status?.version === reply.result.version) { location.reload(); break; }
    }
  }
});
async function usePob(args, busyLabel) {
  for (const id of ['pob-path-apply', 'pob-install']) $(id).disabled = true;
  if (busyLabel) $('pob-path-status').textContent = busyLabel;
  const reply = await run('setup', args).catch(error => ({ ok: false, error: { message: error.message } }));
  for (const id of ['pob-path-apply', 'pob-install']) $(id).disabled = false;
  renderStatus();
  if (!reply.ok) {
    $('pob-path-status').textContent = t(args.pobPath ? 'pobFolderInvalid' : 'pobInstallFailed');
    $('pob-path').setAttribute('aria-invalid', String(Boolean(args.pobPath)));
    if (args.pobPath) $('pob-path').focus();
    return;
  }
  $('pob-path').value = reply.result?.dir ?? '';
  state.pobPathDirty = false;
  $('pob-path').removeAttribute('aria-invalid');
  document.querySelectorAll('.notice').forEach(el => el.remove());
  $('pob-path-status').dataset.i18n = state.live ? 'pobFolderSaved' : 'pobFolderDesc';
  $('pob-path-status').textContent = t($('pob-path-status').dataset.i18n);
  if (!state.live) openPob();
}
if (settingsView) {
  $('pob-path').addEventListener('input', () => { state.pobPathDirty = true; $('pob-path').removeAttribute('aria-invalid'); });
  $('pob-path-apply').addEventListener('click', () => { const dir = $('pob-path').value.trim(); if (dir) usePob({ pobPath: dir }); });
  $('pob-install').addEventListener('click', () => usePob({ installPob: true }, t('installingPob')));
}
async function loadStatus() {
  const reply = await api('/api/status').catch(() => null);
  if (!reply?.ok) return;
  setPobWindow(reply.live);
  state.appVersion = reply.version ?? '';
  state.autoDownloadUpdates = reply.settings?.autoDownloadUpdates !== false;
  state.live = Boolean(reply.live?.connected);
  if (state.live) { state.openingPob = false; clearTimeout(state.openingTimer); }
  state.pobMissing = !state.live && !reply.pob?.dir;
  renderStatus();
  renderPobSetup();
  setTheme(reply.settings?.pobTheme ?? 'pob');
  renderThemeCards();
  const language = normalizeLocalePreference(reply.settings?.pobLanguage);
  if (localePreference() !== language) { setLocale(language); applyI18n(); }
  if (!settingsView) { showUpdate(reply.update); return; }
  if (!state.pobPathDirty) $('pob-path').value = reply.pob?.dir ?? '';
  await characterSync.load();
  renderLocaleOptions();
  showUpdate(reply.update);
}

// ---------- agents ----------
const providerById = id => state.providers.find(p => p.id === id);
const providerName = id => providerById(id)?.label ?? id;
const mark = id => `<span class="agent-provider-mark"><img src="agents/${encodeURIComponent(id)}.svg" alt=""></span>`;
const PROVIDER_SETUP = {
  claude: { login: 'loginClaude', note: 'claudeAccountNote', account: 'https://claude.ai/', guide: 'https://code.claude.com/docs/en/quickstart' },
  codex: { login: 'loginChatgpt', note: 'codexAccountNote', account: 'https://chatgpt.com/', guide: 'https://learn.chatgpt.com/docs/cli' },
  antigravity: { login: 'loginGoogle', note: 'antigravityAccountNote', account: 'https://accounts.google.com/signup', guide: 'https://antigravity.google/docs/getting-started/?tab=cli' },
};

function loginCodeHtml(provider) {
  return `<form class="agent-login-code" data-login-code-form="${provider.id}" novalidate>
    <p>${escapeHtml(t('agentLoginCodeNote'))}</p>
    <label>${escapeHtml(t('agentLoginCodeLabel'))}<input type="password" data-login-code="${provider.id}" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="4096"></label>
    <div class="agent-account-actions"><button type="submit" data-login-code-submit class="agent-primary">${escapeHtml(t('agentLoginCodeSubmit'))}</button></div>
    <p data-login-code-error role="status" hidden></p></form>`;
}
// Keep an in-progress paste across auth polling/focus refreshes, only in the current DOM.
function preserveLoginCode(root) {
  const input = root.querySelector('[data-login-code]');
  const value = input?.value, provider = input?.dataset.loginCode, focused = document.activeElement === input;
  const start = input?.selectionStart, end = input?.selectionEnd;
  return () => {
    const replacement = root.querySelector('[data-login-code]');
    if (!input || replacement?.dataset.loginCode !== provider) return;
    replacement.value = value;
    if (focused) { replacement.focus({ preventScroll: true }); replacement.setSelectionRange(start, end); }
  };
}
function providerAccountHtml(provider) {
  const info = PROVIDER_SETUP[provider.id];
  if (!info) return '';
  if (provider.signingIn) return `${provider.awaitingCode ? loginCodeHtml(provider) : `<p class="agent-auth-progress" role="status">${escapeHtml(t(provider.verifyingLogin ? 'agentLoginVerifying' : 'agentLoginWaiting'))}</p>`}<div class="agent-account-actions"><button type="button" data-login-cancel="${provider.id}">${escapeHtml(t('cancel'))}</button></div>`;
  if (provider.available && provider.auth !== 'signed_out') {
    return provider.auth === 'unknown' ? `<div class="agent-account-actions"><button type="button" data-auth-refresh>${escapeHtml(t('retry'))}</button><a class="agent-link-button" href="${info.guide}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('agentInstallGuide', { agent: provider.label }))}${icon('external-link')}</a></div>` : '';
  }
  return `${provider.loginFailed ? `<p role="status">${escapeHtml(t('agentLoginFailed'))}</p>` : ''}<div class="agent-account-actions">${provider.available
    ? `<button type="button" class="agent-primary" data-login="${provider.id}">${icon('log-in')}${escapeHtml(t(info.login))}</button>`
    : `<a class="agent-link-button agent-primary" href="${info.guide}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('agentInstallGuide', { agent: provider.label }))}${icon('external-link')}</a>`}
    <a class="agent-link-button" href="${info.account}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('createAccount'))}${icon('external-link')}</a></div>`;
}
async function signInProvider(id) {
  const provider = providerById(id);
  if (!provider || provider.signingIn) return;
  provider.signingIn = true;
  provider.loginFailed = false;
  for (const tab of state.tabs) if (tab.provider === id) for (const view of tab.views) {
    if (view.error === 'AGENT_SIGNED_OUT') { view.signInAttempted = true; renderAssistant(view); }
  }
  renderAgents();
  try {
    const reply = await api(`/api/agent/providers/${id}/login`, {});
    if (!reply.ok) { provider.signingIn = false; provider.loginFailed = true; }
    else return loadProviders({ checking: false });
  } catch { provider.signingIn = false; provider.loginFailed = true; }
  renderAgents();
}
function wireAccountButtons(root) {
  root.querySelectorAll('[data-login-code-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = form.querySelector('[data-login-code]'), button = form.querySelector('[data-login-code-submit]');
    const code = input.value;
    input.value = ''; // Do not retain submitted codes in the DOM, history or browser storage.
    input.disabled = button.disabled = true;
    const reply = await api(`/api/agent/providers/${form.dataset.loginCodeForm}/login/code`, { code });
    if (reply.ok || reply.error?.code === 'AGENT_LOGIN_EXPIRED') { await loadProviders({ checking: false }); return; }
    input.disabled = button.disabled = false;
    const error = form.querySelector('[data-login-code-error]');
    error.textContent = t(reply.error?.code === 'AGENT_LOGIN_CODE_INVALID' ? 'agentLoginCodeInvalid' : 'agentLoginFailed');
    error.hidden = false;
    input.focus();
  }));
  root.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => signInProvider(button.dataset.login)));
  root.querySelectorAll('[data-auth-refresh]').forEach(button => button.addEventListener('click', () => loadProviders()));
  root.querySelectorAll('[data-login-cancel]').forEach(button => button.addEventListener('click', async () => {
    await request('DELETE', `/api/agent/providers/${button.dataset.loginCancel}/login`).catch(() => {});
    loadProviders();
  }));
}

async function loadProviders({ checking = true } = {}) {
  const generation = state.providerRequest = (state.providerRequest ?? 0) + 1;
  const previousAuth = new Map(state.providers.map(provider => [provider.id, provider.auth]));
  clearTimeout(state.loginPoll);
  if (checking) {
    for (const provider of state.providers) if (provider.available) provider.auth = 'checking';
    if (state.loadedProviders) renderAgents();
  }
  const reply = await api('/api/agent/providers').catch(() => ({ providers: [] }));
  if (generation !== state.providerRequest) return;
  if (!reply.ok) return;
  const changed = checking || !state.loadedProviders || JSON.stringify(state.providers) !== JSON.stringify(reply.providers);
  for (const provider of reply.providers ?? []) {
    if (providerById(provider.id)?.command !== provider.command
      || (provider.auth === 'signed_in' && previousAuth.get(provider.id) !== 'signed_in')) delete state.models[provider.id];
  }
  state.providers = reply.providers ?? [];
  const available = state.providers.filter(p => p.available);
  if (!providerById(state.provider) || (!state.loadedProviders && !providerById(state.provider)?.available)) {
    state.provider = available[0]?.id ?? state.providers[0]?.id ?? '';
  }
  state.loadedProviders = true;
  if (changed) {
    renderAgents();
    for (const tab of state.tabs) for (const view of tab.views) if (view.error === 'AGENT_SIGNED_OUT') renderAssistant(view);
    if (!settingsView) renderModelLabel();
  }
  if (state.providers.some(p => p.signingIn)) state.loginPoll = setTimeout(() => loadProviders({ checking: false }), 1500);
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
  if (reply.ok && !reply.cancelled) store.set('pobai.providersChanged', String(Date.now()));
  await loadProviders();
}

function permissionsHtml(id, choice, disabled = false) {
  return `<div class="agent-permissions"><label><input type="checkbox" data-full-access aria-describedby="${id}-note" ${choice.fullAccess ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(t('fullAccess'))}</label>
    <p id="${id}-note" ${choice.fullAccess ? '' : 'hidden'}>${escapeHtml(t('fullAccessDesc'))}</p></div>`;
}
function wirePermissions(root, choice) {
  root.querySelector('[data-full-access]')?.addEventListener('change', e => {
    choice.fullAccess = e.target.checked;
    root.querySelector('.agent-permissions p').hidden = !choice.fullAccess;
    if (root === $('model-popover') && !activeTab()) renderAgents();
  });
}

/** The agent picker: provider and permissions for this new chat, then start. */
function pickerHtml(popover) {
  if (!state.loadedProviders) return `<p class="agent-chat-progress"><span class="spinner"></span>${escapeHtml(t('checkingAgents'))}</p>`;
  if (!state.providers.length) return `<p class="agent-picker-note"><span>${escapeHtml(t('noAgent'))}</span></p>`;
  const chosen = providerById(state.provider);
  const cards = state.providers.map(p => `<button type="button" role="radio" aria-checked="${p.id === state.provider}" tabindex="${p.id === state.provider ? 0 : -1}" data-provider="${p.id}">
      ${mark(p.id)}<span class="agent-provider-label"><strong>${escapeHtml(p.label)}</strong>
      <small class="${p.auth === 'signed_in' && !p.signingIn ? 'ok' : ''}">${escapeHtml(t(!p.available ? 'agentNeedsPath' : p.signingIn ? 'agentCheckingAuth' : ({ signed_in: 'agentSignedIn', signed_out: 'agentSignedOut', unknown: 'agentAuthUnknown' }[p.auth] ?? 'agentCheckingAuth')))}</small></span>
      ${p.id === state.provider ? `<span class="agent-provider-check">${icon('check')}</span>` : ''}</button>`).join('');
  const note = chosen && !chosen.available
    ? `<button type="button" class="agent-quiet agent-path-shortcut" data-settings>${icon('folder-open')}${escapeHtml(t('choosePath'))}</button>` : '';
  const account = chosen && (!chosen.available || chosen.signingIn || ['signed_out', 'unknown'].includes(chosen.auth))
    ? `<div class="agent-account">${!chosen.signingIn && chosen.auth !== 'unknown' ? `<p>${escapeHtml(t(PROVIDER_SETUP[chosen.id].note))}</p>` : ''}${providerAccountHtml(chosen)}${note}</div>` : '';
  const actions = popover
    ? `<button type="button" class="agent-primary agent-start" data-start ${chosen?.available && !chosen.signingIn && ['signed_in', 'unknown'].includes(chosen.auth) ? '' : 'disabled'}>${escapeHtml(t('startWith', { agent: chosen?.label ?? '' }))}</button>
       <button type="button" class="agent-quiet" data-resume>${icon('history')}${escapeHtml(t('resumePrevious'))}</button>` : '';
  return `<div class="agent-picker"><h3>${escapeHtml(t(popover ? 'newChat' : 'chooseAgent'))}</h3>
    <div class="agent-provider-grid" role="radiogroup" aria-label="${escapeHtml(t('chooseAgent'))}">${cards}</div>${account}
    ${permissionsHtml(popover ? 'new-chat-permissions' : 'initial-chat-permissions', popover ? state.picker : state.idle)}${actions}</div>`;
}
function wirePicker(root, popover = false) {
  const choice = popover ? state.picker : state.idle;
  wirePermissions(root, choice);
  wireAccountButtons(root);
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
  root.querySelector('[data-settings]')?.addEventListener('click', () => openSettings());
  root.querySelector('[data-start]')?.addEventListener('click', () => {
    closePopovers(); newTab(state.provider, { fullAccess: choice.fullAccess }); $('input').focus();
  });
  root.querySelector('[data-resume]')?.addEventListener('click', () => { closePopovers(); loadHistory(); openModal($('history-dialog')); });
}
function renderAgents() {
  if (!settingsView) {
    for (const [id, popover] of [['picker-inline', false], ['picker-popover', true]]) {
      const root = $(id);
      if (popover && root.hidden) continue;
      const focused = root.contains(document.activeElement) ? document.activeElement : null;
      const restoreCode = preserveLoginCode(root);
      const key = focused && ['provider', 'full-access', 'start', 'resume', 'login', 'login-cancel', 'login-code', 'login-code-submit', 'auth-refresh', 'settings'].find(name => focused.hasAttribute('data-' + name));
      const selector = key ? `[data-${key}${key === 'provider' ? `="${focused.dataset.provider}"` : ''}]` : null;
      root.innerHTML = pickerHtml(popover);
      wirePicker(root, popover);
      restoreCode();
      if (focused) {
        const replacement = selector && root.querySelector(selector);
        (replacement && !replacement.disabled ? replacement : root.querySelector('[aria-checked=true]'))?.focus({ preventScroll: true });
      }
    }
    renderPobSetup();
    return;
  }
  const restoreCode = preserveLoginCode($('agent-rows'));
  $('agent-rows').innerHTML = state.providers.map(p => {
    const where = p.command ? `${t({ custom: 'pathCustom', env: 'pathEnv', auto: 'pathAuto' }[p.source] ?? 'pathAuto')} · ${p.command}` : t('agentNeedsPath');
    return `<div class="agent-row">${mark(p.id)}<div><div class="set-title">${escapeHtml(p.label)}</div>
      <p class="set-desc" title="${escapeHtml(p.command ?? '')}">${escapeHtml(p.available ? where : (p.command ? `${t('pathMissing')} · ${p.command}` : where))}</p></div>
      <div class="set-actions"><button type="button" data-pick="${p.id}">${icon('folder-open')}${escapeHtml(t(p.command ? 'changePath' : 'choosePath'))}</button>
      ${p.source === 'custom' ? `<button type="button" class="agent-quiet" data-auto="${p.id}">${icon('refresh-cw')}${escapeHtml(t('autoDetect'))}</button>` : ''}
      ${providerAccountHtml(p)}</div></div>`;
  }).join('');
  $('agent-rows').querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pickPath(b.dataset.pick)));
  $('agent-rows').querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', async () => {
    const reply = await request('DELETE', `/api/agent/providers/${b.dataset.auto}/path`);
    if (reply.ok) store.set('pobai.providersChanged', String(Date.now()));
    loadProviders();
  }));
  wireAccountButtons($('agent-rows'));
  restoreCode();
}

// ---------- popovers ----------
function closePopovers() {
  state.popoverRequest = (state.popoverRequest ?? 0) + 1;
  $('picker-popover').hidden = true;
  $('model-popover').hidden = true;
  $('popover-backdrop').hidden = true;
  $('new-chat').setAttribute('aria-expanded', 'false');
  $('model-button').setAttribute('aria-expanded', 'false');
}
$('popover-backdrop').addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); closePopovers(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const button = !$('picker-popover').hidden ? 'new-chat' : !$('model-popover').hidden ? 'model-button' : null;
    closePopovers(); if (button) $(button).focus();
  }
});
for (const id of ['picker-popover', 'model-popover']) $(id).addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const targets = [...$(id).querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
  const target = event.shiftKey ? targets.at(-1) : targets[0];
  if (document.activeElement === (event.shiftKey ? targets[0] : targets.at(-1))) { event.preventDefault(); target?.focus(); }
});
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#picker-popover, #new-chat, #model-popover, #model-button')) closePopovers();
});
function positionPicker() {
  const top = Math.min($('new-chat').getBoundingClientRect().bottom + 6, window.innerHeight - 120);
  $('picker-popover').style.setProperty('--picker-top', `${Math.max(12, top)}px`);
}
window.addEventListener('resize', () => { if (!$('picker-popover').hidden) positionPicker(); });
$('new-chat').addEventListener('click', () => {
  const open = $('picker-popover').hidden;
  closePopovers();
  if (!open) return;
  state.picker.fullAccess = false;
  positionPicker();
  $('picker-popover').hidden = false;
  $('popover-backdrop').hidden = false;
  $('new-chat').setAttribute('aria-expanded', 'true');
  renderAgents();
  loadProviders();
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
  const current = currentChoice();
  if (current.provider !== provider || current.model !== model || current.effort !== effort) return;
  const selected = catalog.models.find(m => m.id === model);
  const name = selected?.name ?? (model || t('modelDefault'));
  const effectiveEffort = effort ?? (provider === 'antigravity' ? selected?.defaultEffort : catalog.defaultEffort ?? 'medium');
  $('model-label').textContent = effectiveEffort ? `${name} · ${effortName(effectiveEffort)}` : name;
  $('model-button').title = `${t('model')} · ${t('effort')}`;
}
$('model-button').addEventListener('click', async () => {
  const open = $('model-popover').hidden;
  closePopovers();
  if (!open) return;
  const request = state.popoverRequest, tabKey = state.active;
  const { provider, model, effort } = currentChoice();
  const catalog = await models(provider);
  if (request !== state.popoverRequest || tabKey !== state.active || currentChoice().provider !== provider) return;
  const selected = catalog.models.find(m => m.id === model);
  const nativeDefault = provider === 'antigravity' && !model;
  // With no selected Antigravity model, preserve its own default and only offer shared levels.
  const efforts = nativeDefault ? (catalog.models[0]?.efforts ?? []).filter(e => catalog.models.every(m => m.efforts.includes(e)))
    : selected?.efforts?.length ? selected.efforts : ['low', 'medium', 'high'];
  const popover = $('model-popover');
  popover.innerHTML = `<label>${escapeHtml(t('model'))}<select id="model-select"><option value="">${escapeHtml(t('modelDefault'))}</option>
      ${catalog.models.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === model ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select></label>
    <label>${escapeHtml(t('effort'))}<select id="effort-select">${nativeDefault ? `<option value="" ${!effort ? 'selected' : ''}>${escapeHtml(t('modelDefault'))}</option>` : ''}${efforts.map(e => `<option value="${escapeHtml(e)}" ${(effort ?? (nativeDefault ? null : selected?.defaultEffort ?? catalog.defaultEffort)) === e ? 'selected' : ''}>${escapeHtml(effortName(e))}</option>`).join('')}</select></label>
    <p>${escapeHtml(t('modelNote'))}</p>
    ${permissionsHtml('conversation-permissions', activeTab() ?? state.idle, activeTab()?.running)}`;
  popover.hidden = false;
  $('popover-backdrop').hidden = false;
  $('model-button').setAttribute('aria-expanded', 'true');
  const apply = () => setChoice($('model-select').value || null, $('effort-select').value || null);
  $('model-select').addEventListener('change', () => {
    const nextModel = $('model-select').value || null, next = catalog.models.find(row => row.id === nextModel);
    const previousEffort = $('effort-select').value;
    const nextEffort = provider === 'antigravity' && !nextModel ? null
      : next?.efforts?.length && !next.efforts.includes(previousEffort) ? next.defaultEffort ?? next.efforts[0] : previousEffort;
    setChoice(nextModel, nextEffort || null); closePopovers(); $('model-button').click();
  });
  $('effort-select').addEventListener('change', apply);
  wirePermissions(popover, activeTab() ?? state.idle);
});

// ---------- images ----------
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function addImages(files) {
  const attachments = state.attachments;
  for (const file of files) {
    if (attachments.length >= 4) { showNotice(t('imageTooMany')); break; }
    if (!IMAGE_TYPES.includes(file.type)) { showNotice(t('imageInvalid')); continue; }
    if (file.size > 5 * 1024 * 1024) { showNotice(t('imageTooLarge')); continue; }
    const reader = new FileReader();
    reader.onload = () => {
      if (attachments.length >= 4) return;
      attachments.push({ name: file.name || 'image', dataUrl: reader.result });
      if (state.attachments === attachments) renderAttachments();
    };
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
// Each tab keeps its own conversation, model choice and unsent composer content.
let nextKey = 1;
const activeTab = () => state.tabs.find(tab => tab.key === state.active) ?? null;
function saveTabs() {
  store.set('pobai.tabs', JSON.stringify(state.tabs.filter(tab => tab.sessionId).map(tab => tab.sessionId)));
  store.set('pobai.activeTab', activeTab()?.sessionId ?? '');
}
function newTab(provider, session = {}) {
  const pane = document.createElement('div');
  pane.className = 'chat-pane';
  pane.id = `chat-pane-${nextKey}`;
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', `session-tab-${nextKey}`);
  $('chat').append(pane);
  const tab = { key: nextKey++, sessionId: session.id ?? null, provider: session.provider ?? provider, title: session.title ?? '',
    model: session.model ?? null, effort: session.effort ?? null, fullAccess: session.fullAccess === true,
    running: false, pane, views: [], draft: '', attachments: [] };
  if (!session.id) {
    tab.model = store.get(`pobai.model.${tab.provider}`, '') || null;
    tab.effort = store.get(`pobai.effort.${tab.provider}`, '') || null;
  }
  state.tabs.push(tab);
  activate(tab.key);
  return tab;
}
function activate(key) {
  closePopovers();
  const previous = activeTab() ?? (state.active === null ? state.idle : null);
  if (previous) { previous.draft = $('input').value; previous.attachments = state.attachments; }
  state.active = key;
  const current = activeTab() ?? state.idle;
  $('input').value = current.draft;
  state.attachments = current.attachments;
  autosize();
  renderAttachments();
  for (const tab of state.tabs) tab.pane.hidden = tab.key !== key;
  updateEmpty();
  renderTabs();
  renderModelLabel();
  renderSend();
  saveTabs();
  $('sessions').querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function updateEmpty() {
  const tab = activeTab();
  $('empty').hidden = Boolean(tab && tab.pane.childElementCount);
  $('picker-inline').hidden = Boolean(tab);
  renderPobSetup();
}
function closeTab(key) {
  const index = state.tabs.findIndex(tab => tab.key === key);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  tab.pane.remove();
  if (state.active === key) activate(state.tabs[Math.min(index, state.tabs.length - 1)]?.key ?? null);
  else { renderTabs(); saveTabs(); }
  ($('sessions').querySelector('[aria-selected=true]') ?? $('new-chat')).focus();
}
function renderTabs() {
  const nav = $('sessions');
  nav.setAttribute('aria-label', t('chatTabs'));
  nav.innerHTML = state.tabs.map((tab, i) => `<div class="agent-session-tab" data-active="${tab.key === state.active}">
      <button id="session-tab-${tab.key}" type="button" role="tab" aria-selected="${tab.key === state.active}" aria-controls="${tab.pane.id}" tabindex="${tab.key === state.active ? 0 : -1}" data-tab="${tab.key}" title="${escapeHtml(tab.title || providerName(tab.provider))}">
        ${mark(tab.provider)}<span>${escapeHtml(providerName(tab.provider))} ${i + 1}</span><span class="agent-dot ${tab.running ? 'on' : ''}"></span></button>
      <button type="button" class="agent-session-close" data-close-tab="${tab.key}" title="${escapeHtml(t('closeChat'))}" aria-label="${escapeHtml(t('closeChat'))}">${icon('x')}</button></div>`).join('') || `<span class="agent-session-empty">${escapeHtml(t('newChat'))}</span>`;
  nav.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => activate(Number(b.dataset.tab))));
  nav.querySelectorAll('[data-close-tab]').forEach(b => b.addEventListener('click', () => closeTab(Number(b.dataset.closeTab))));
  nav.querySelectorAll('[data-tab]').forEach((button, i) => button.addEventListener('keydown', e => {
    const last = state.tabs.length - 1;
    const next = { ArrowRight: (i + 1) % state.tabs.length, ArrowLeft: (i + last) % state.tabs.length, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    activate(state.tabs[next].key);
    nav.querySelector('[aria-selected=true]')?.focus();
  }));
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
  AGENT_OUTDATED: ['errOutdated', 'update'],
  AGENT_RATE_LIMITED: ['errRateLimit'], AGENT_NETWORK: ['errNetwork', 'retry'], AGENT_MODEL_UNAVAILABLE: ['errModelUnavailable', 'model'],
  AGENT_PERMISSIONS: ['errPermissions', 'permissions'],
  SERVICE_DISCONNECTED: ['errServiceDisconnected'],
  AGENT_SANDBOX: ['errSandbox'], AGENT_CONFIG: ['errConfig'], AGENT_NO_RESPONSE: ['errNoResponse'], AGENT_PROTOCOL: ['errProtocol'],
  AGENT_FAILED: ['errFailed', 'retry'], BUSY: ['errBusy'], AGENT_PATH_INVALID: ['errPathInvalid', 'pick'],
  IMAGE_TOO_MANY: ['imageTooMany'], IMAGE_TOO_LARGE: ['imageTooLarge'], IMAGE_INVALID: ['imageInvalid'], IMAGE_QUOTA: ['imageTooLarge'],
};
function renderAssistant(view) {
  const restoreCode = preserveLoginCode(view.el);
  const { tab } = view;
  const agent = providerName(tab.provider);
  const text = [...view.texts.values()].join('\n\n');
  let [errorKey, action] = view.error ? ERRORS[view.error] ?? ['error'] : [];
  const provider = providerById(tab.provider);
  if (view.error === 'AGENT_SIGNED_OUT' && provider?.signingIn) { errorKey = provider.verifyingLogin ? 'agentLoginVerifying' : 'agentLoginWaiting'; action = 'cancelLogin'; }
  else if (view.error === 'AGENT_SIGNED_OUT' && view.signInAttempted && provider?.auth === 'signed_in' && !provider.loginFailed) { errorKey = 'agentSignedIn'; action = view.retry ? 'retry' : null; }
  const actionLabel = { pick: 'choosePath', login: 'signIn', retry: 'retry', model: 'model', permissions: 'agentPermissions', cancelLogin: 'cancel' }[action];
  const diagnostics = view.error && !['AGENT_SIGNED_OUT', 'AGENT_MISSING', 'AGENT_RATE_LIMITED', 'AGENT_NETWORK', 'AGENT_MODEL_UNAVAILABLE', 'AGENT_PERMISSIONS', 'IMAGE_TOO_MANY', 'IMAGE_TOO_LARGE', 'IMAGE_INVALID', 'BUSY'].includes(view.error);
  keepScroll(() => {
    view.el.innerHTML = `<div class="agent-message-who">${mark(tab.provider)}${escapeHtml(agent)}${view.interrupted ? `<span class="tag">${escapeHtml(t('interrupted'))}</span>` : ''}</div>
      <div class="agent-message-body">${markdown(text)}</div>
      ${view.working ? `<div class="agent-chat-progress"><span class="spinner"></span>${escapeHtml(t(PHASES[view.phase] ?? 'thinking'))}</div>` : ''}
      ${view.error ? `<div class="agent-error" role="status"><span>${escapeHtml(t(errorKey, { agent }))}</span>${view.error === 'AGENT_SIGNED_OUT' && provider?.awaitingCode ? loginCodeHtml(provider) : ''}<div class="agent-error-actions">${actionLabel ? `<button type="button" data-action="${action}">${escapeHtml(t(actionLabel))}</button>` : ''}${action === 'update' ? `<a class="agent-link-button" href="${PROVIDER_SETUP[tab.provider].guide}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('agentInstallGuide', { agent: providerName(tab.provider) }))}</a>` : ''}${diagnostics ? `<button type="button" class="agent-quiet" data-diagnostics>${escapeHtml(t('diagnostics'))}</button>` : ''}</div></div>` : ''}`;
    wireAccountButtons(view.el);
    restoreCode();
    view.el.querySelector('[data-action]')?.addEventListener('click', () => {
      if (action === 'pick') pickPath(tab.provider);
      if (action === 'login') signInProvider(tab.provider);
      if (action === 'retry' && view.retry) send(view.retry.text, view.retry.images, tab);
      if (action === 'model' || action === 'permissions') { activate(tab.key); $('model-button').click(); }
      if (action === 'cancelLogin') { request('DELETE', `/api/agent/providers/${tab.provider}/login`).then(() => loadProviders()); }
    });
    view.el.querySelector('[data-diagnostics]')?.addEventListener('click', () => {
      $('diagnostics-reason').textContent = t(errorKey, { agent });
      $('diagnostics-report').textContent = JSON.stringify({ code: view.error, provider: tab.provider,
        log: '%LOCALAPPDATA%\\pob-ai\\logs\\service.log', ...view.diagnostic }, null, 2);
      $('diagnostics-note').textContent = t('diagnosticNote');
      $('copy-diagnostics').textContent = t('copyDiagnostics');
      openModal($('diagnostics-dialog'));
    });
  });
}

$('copy-diagnostics').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('diagnostics-reason').textContent + '\n\n' + $('diagnostics-report').textContent);
    $('copy-diagnostics').textContent = t('diagnosticCopied');
  } catch { $('diagnostics-note').textContent = t('diagnosticCopyFailed'); }
});

/** Reads the chat event stream into a view (POST /api/agent/chat and GET .../stream). */
async function readStream(response, tab, view) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
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
      if (event.type === 'start') {
        tab.sessionId = event.sessionId ?? tab.sessionId;
        tab.fullAccess = event.fullAccess === true;
        if (tab === activeTab()) renderSend();
        saveTabs();
      }
      if (event.type === 'phase') view.phase = event.phase;
      if (event.type === 'text') view.texts.set(event.id, event.partial ? (view.texts.get(event.id) ?? '') + event.text : event.text);
      if (event.type === 'error') { view.error = event.code; view.diagnostic = event.diagnostic; }
      if (event.type === 'end') { ended = true; view.interrupted = event.delivery === 'interrupted'; tab.sessionId = event.sessionId ?? tab.sessionId; }
      renderAssistant(view);
    }
  }
  if (!ended) throw new Error('SERVICE_DISCONNECTED');
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
  const fromComposer = images === state.attachments;
  let tab = target;
  if (!tab) {
    if (!providerById(state.provider)?.available) { renderAgents(); return; }
    const fullAccess = state.idle.fullAccess;
    tab = newTab(state.provider);
    tab.fullAccess = fullAccess;
    state.idle.fullAccess = false;
  }
  if (tab.running) return;
  if (!tab.title) tab.title = (text.trim() || images[0]?.name || '').slice(0, 60);
  addUser(tab, text, images.map(a => ({ src: a.dataUrl, name: a.name })));
  const view = addAssistant(tab);
  view.retry = { text, images };
  renderAssistant(view);
  tab.running = true;
  renderTabs(); renderSend();
  const body = { sessionId: tab.sessionId, provider: tab.provider, message: text, fullAccess: tab.fullAccess === true,
    locale: locale(), images: images.length ? images : undefined };
  if (!tab.sessionId || tab.choiceChanged) { body.model = tab.model; body.effort = tab.effort; tab.choiceChanged = false; }
  if (fromComposer) {
    $('input').value = '';
    tab.draft = '';
    if (!target) state.idle.draft = '';
    autosize();
    (target ?? state.idle).attachments = [];
    state.attachments = [];
    renderAttachments();
  }
  try {
    const response = await fetch('/api/agent/chat', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok || !response.body) {
      const error = (await response.json().catch(() => ({}))).error;
      view.error = error?.code ?? 'AGENT_FAILED'; view.diagnostic = error?.diagnostic;
    }
    else await readStream(response, tab, view);
  } catch (error) {
    view.error ??= error instanceof SyntaxError ? 'AGENT_PROTOCOL' : 'SERVICE_DISCONNECTED';
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
      view.diagnostic = m.diagnostic;
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
    else view.error = 'SERVICE_DISCONNECTED';
  } catch (error) {
    view.error ??= error instanceof SyntaxError ? 'AGENT_PROTOCOL' : 'SERVICE_DISCONNECTED';
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
  if (!reply.ok) { list.innerHTML = `<li class="history-empty">${escapeHtml(t('connectionLost'))}</li>`; return; }
  const sessions = (reply.sessions ?? []).slice().reverse();
  if (!sessions.length) { list.innerHTML = `<li class="history-empty">${escapeHtml(t('noHistory'))}</li>`; return; }
  list.innerHTML = sessions.map(s => `<li>
      <button type="button" class="open" data-open="${s.id}">${mark(s.provider)}<span class="title" title="${escapeHtml(s.title || providerName(s.provider))}">${escapeHtml(s.title || providerName(s.provider))}</span>
        <span class="date">${escapeHtml(new Date(s.updatedAt ?? s.createdAt).toLocaleDateString(locale()))}</span></button>
      <button type="button" class="agent-icon del" data-delete="${s.id}" title="${escapeHtml(t('deleteChat'))}" aria-label="${escapeHtml(t('deleteChat'))}">${icon('trash-2')}</button></li>`).join('');
  list.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { $('history-dialog').close(); openChat(b.dataset.open); }));
  // Deleting takes a second click within three seconds (poe2way's "click again to remove").
  list.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => {
    if (!b.hasAttribute('data-armed')) {
      b.setAttribute('data-armed', '');
      b.title = t('confirmDelete');
      b.setAttribute('aria-label', b.title);
      setTimeout(() => { b.removeAttribute('data-armed'); b.title = t('deleteChat'); b.setAttribute('aria-label', b.title); }, 3000);
      return;
    }
    const deleted = await request('DELETE', `/api/agent/sessions/${b.dataset.delete}`);
    if (!deleted.ok) return;
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
if (settingsView) {
  const dialog = $('settings-dialog');
  dialog.open = true;
  dialog.setAttribute('aria-modal', 'true');
  const close = () => { if (window.chrome?.webview) window.chrome.webview.postMessage('window:close'); else window.close(); };
  dialog.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  loadProviders();
  if (params.get('focus') === 'pob-path') $('pob-path').focus();
} else loadProviders().then(restoreTabs);
loadStatus();
listenEvents();
window.addEventListener('focus', () => loadProviders());
window.addEventListener('pobai:activated', () => loadProviders());
