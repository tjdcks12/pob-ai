import { LOCALES, locale, setLocale, t } from './i18n.js';

const $ = id => document.getElementById(id);
const store = {
  get: (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
};

// The service hands the panel its token once in the URL; keep it for this window only.
const params = new URLSearchParams(location.search);
if (params.get('token')) { sessionStorage.setItem('pobai.token', params.get('token')); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('pobai.token') ?? '';
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const api = async (path, body) => {
  const response = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  return response.json();
};
const run = (command, args = {}) => api('/api/run', { command, args, lang: locale() });

const state = { live: false, sessionId: null, busy: false, controller: null, providers: [] };

// ---------- language & theme ----------
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-title]').forEach(el => { el.title = t(el.dataset.title); el.setAttribute('aria-label', t(el.dataset.title)); });
  document.querySelectorAll('[data-placeholder]').forEach(el => { el.placeholder = t(el.dataset.placeholder); });
  document.querySelectorAll('[data-suggest]').forEach(el => { el.textContent = t(el.dataset.suggest); });
  renderStatus();
  refreshBuild();
  showUpdate(state.update);
}
$('locale').innerHTML = Object.entries(LOCALES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
$('locale').value = locale();
$('locale').addEventListener('change', e => { setLocale(e.target.value); applyI18n(); });
const theme = store.get('pobai.theme', 'ember');
document.documentElement.dataset.theme = theme;
$('theme').value = theme;
$('theme').addEventListener('change', e => { document.documentElement.dataset.theme = e.target.value; store.set('pobai.theme', e.target.value); });
setLocale(locale());

// ---------- PoB status & build card ----------
function renderStatus() {
  const pill = $('pob-status');
  pill.className = `pill ${state.live ? 'on' : 'off'}`;
  pill.querySelector('.label').textContent = state.live ? t('connected') : `${t('disconnected')} · ${t('openPob')}`;
}
$('pob-status').addEventListener('click', async () => { if (!state.live) await run('open'); });

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
  $('build-stats').innerHTML = cells.filter(([, v]) => v !== undefined).map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${fmt(v)}</dd></div>`).join('');
}

function listenEvents() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('pob', e => { state.live = JSON.parse(e.data).connected; renderStatus(); refreshBuild(); });
  source.addEventListener('build-changed', () => refreshBuild());
  source.addEventListener('update', e => showUpdate(JSON.parse(e.data)));
}

// ---------- PoB window settings & PoB AI updates ----------
$('window-language').innerHTML = Object.entries(LOCALES).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
$('window-language').addEventListener('change', e => run('ui.language', { language: e.target.value }));
$('window-theme').addEventListener('change', e => run('ui.theme', { theme: e.target.value }));
function showUpdate(update) {
  state.update = update?.available ? update : null;
  $('update-banner').hidden = !state.update;
  if (state.update) $('update-text').textContent = t('updateAvailable').replace('{version}', state.update.latest);
}
$('update-now').addEventListener('click', async () => {
  $('update-now').disabled = true;
  $('update-text').textContent = t('updating');
  const reply = await run('update.apply', { restart: true });
  if (!reply.ok) { $('update-now').disabled = false; showUpdate(state.update); showNotice(`${t('error')}: ${reply.error?.message ?? ''}`); }
});
async function loadStatus() {
  const reply = await api('/api/status').catch(() => null);
  if (!reply?.ok) return;
  $('window-language').value = reply.settings?.pobLanguage ?? 'en';
  $('window-theme').value = reply.settings?.pobTheme || 'default';
  showUpdate(reply.update);
}

// ---------- agents ----------
async function loadProviders() {
  const reply = await api('/api/agent/providers');
  state.providers = reply.providers ?? [];
  const available = state.providers.filter(p => p.available);
  $('provider').innerHTML = state.providers.map(p => `<option value="${p.id}" ${p.available ? '' : 'disabled'}>${p.label}</option>`).join('');
  const saved = store.get('pobai.provider', available[0]?.id);
  $('provider').value = available.some(p => p.id === saved) ? saved : available[0]?.id ?? '';
  if (!available.length) showNotice(t('noAgent'));
}
$('provider').addEventListener('change', e => store.set('pobai.provider', e.target.value));

function showNotice(text) {
  const note = document.createElement('div');
  note.className = 'notice';
  note.textContent = text;
  $('chat').prepend(note);
}

// ---------- markdown (safe subset) ----------
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [line];
      while (i + 1 < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) items.push(lines[++i]);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(it => `<li>${inline(it.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^#{1,4}\s/.test(line)) out.push(`<p><strong>${inline(line.replace(/^#+\s/, ''))}</strong></p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
}

// ---------- chat ----------
function addUser(text) {
  $('empty').hidden = true;
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  $('chat').append(el);
  el.scrollIntoView({ block: 'end' });
}
function addAssistant() {
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = '<details class="steps" hidden><summary><span class="spinner"></span><span class="count"></span></summary><ol></ol></details><div class="body"></div>';
  $('chat').append(el);
  return el;
}
function renderAssistant(el, { text, tools = [], working = false, error }) {
  const steps = el.querySelector('.steps');
  steps.hidden = !tools.length && !working;
  steps.querySelector('.spinner').hidden = !working;
  steps.querySelector('.count').textContent = working && !tools.length ? t('thinking') : `${tools.length} ${t('steps')}${working ? ` · ${t('thinking')}` : ''}`;
  steps.querySelector('ol').innerHTML = tools.map(s => `<li class="${s.ok === false ? 'fail' : ''}">${escapeHtml(String(s.command ?? s))}</li>`).join('');
  el.querySelector('.body').innerHTML = markdown(text ?? '') + (error ? `<p class="error">${escapeHtml(error)}</p>` : '');
  el.scrollIntoView({ block: 'end' });
}

function setBusy(busy) {
  state.busy = busy;
  $('send').textContent = busy ? t('stop') : t('send');
  $('send').classList.toggle('stop', busy);
}

async function send(text) {
  if (!text.trim() || state.busy) return;
  addUser(text);
  const el = addAssistant();
  const view = { text: '', tools: [], working: true };
  renderAssistant(el, view);
  setBusy(true);
  state.controller = new AbortController();
  try {
    const response = await fetch('/api/agent/chat', {
      method: 'POST', headers, signal: state.controller.signal,
      body: JSON.stringify({ sessionId: state.sessionId, provider: $('provider').value, message: text, locale: locale() }),
    });
    if (!response.ok || !response.body) throw new Error((await response.json()).error?.message ?? t('error'));
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
        if (event.type === 'start' || event.type === 'end') state.sessionId = event.sessionId ?? state.sessionId;
        if (event.type === 'text') view.text += (view.text ? '\n\n' : '') + event.text;
        if (event.type === 'tool') view.tools.push({ id: event.id, command: event.command });
        if (event.type === 'tool-result') { const step = view.tools.find(s => s.id === event.id); if (step) step.ok = event.ok; }
        if (event.type === 'result' && !view.text && event.text) view.text = event.text;
        if (event.type === 'error') view.error = event.message;
        renderAssistant(el, view);
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') view.error = error.message;
  } finally {
    view.working = false;
    renderAssistant(el, view);
    setBusy(false);
    loadHistory();
  }
}

$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy) {
    state.controller?.abort();
    await api('/api/agent/stop', { sessionId: state.sessionId });
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});
document.querySelectorAll('[data-suggest]').forEach(el => el.addEventListener('click', () => {
  $('input').value = t(el.dataset.suggest); autosize(); $('input').focus();
}));

// ---------- history ----------
function newChat() {
  state.sessionId = null;
  $('chat').querySelectorAll('.msg, .notice').forEach(el => el.remove());
  $('empty').hidden = false;
  loadHistory();
}
async function openChat(id) {
  const reply = await api(`/api/agent/sessions/${id}`);
  if (!reply.ok) return;
  newChat();
  state.sessionId = id;
  for (const m of reply.session.messages) {
    if (m.role === 'user') addUser(m.text);
    else renderAssistant(addAssistant(), { text: m.text, tools: (m.tools ?? []).map(command => ({ command })) });
  }
  loadHistory();
}
async function loadHistory() {
  const reply = await api('/api/agent/sessions').catch(() => ({ sessions: [] }));
  const list = $('history-list');
  list.innerHTML = '';
  for (const s of (reply.sessions ?? []).slice().reverse()) {
    const li = document.createElement('li');
    if (s.id === state.sessionId) li.className = 'active';
    const open = Object.assign(document.createElement('button'), { className: 'open', type: 'button', textContent: s.title });
    open.addEventListener('click', () => openChat(s.id));
    const del = Object.assign(document.createElement('button'), { className: 'del', type: 'button', textContent: '✕', title: t('deleteChat') });
    del.addEventListener('click', async () => { await fetch(`/api/agent/sessions/${s.id}`, { method: 'DELETE', headers }); if (s.id === state.sessionId) newChat(); else loadHistory(); });
    li.append(open, del);
    list.append(li);
  }
}
$('new-chat').addEventListener('click', newChat);
$('toggle-history').addEventListener('click', () => { $('history').hidden = !$('history').hidden; $('settings').hidden = true; });
$('toggle-settings').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; $('history').hidden = true; });

applyI18n();
loadProviders();
loadHistory();
loadStatus();
listenEvents();
