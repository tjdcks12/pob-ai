// PoB window translation, service side: builds the phrase dictionary for a language and renders
// translated phrases to PNG images that adapter/live/translate.lua draws in place of PoB's text.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { loadTerms } from '../i18n/terms.mjs';
import { statePath, writeJson } from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');

// Windows fonts that cover each script.
export const WINDOW_FONTS = {
  ko: 'Malgun Gothic', ja: 'Yu Gothic UI', 'zh-Hant': 'Microsoft JhengHei UI', th: 'Leelawadee UI',
  ru: 'Segoe UI', de: 'Segoe UI', fr: 'Segoe UI', es: 'Segoe UI', 'pt-BR': 'Segoe UI', en: 'Segoe UI',
};

function itemPack(locale) {
  const dir = path.join(ROOT, 'data', 'items', 'locales');
  const file = fs.readdirSync(dir).find(n => n.startsWith(`${locale}.`) && n.endsWith('.json.gz'));
  return file ? JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, file)))).pack : null;
}

/**
 * English phrase -> phrase in `locale`. Sources, later ones winning: game client strings with the
 * same English text, official item/skill/class names, passive names and passive stat lines, and
 * PoB's own interface text (data/ui/<locale>.json, written for PoB AI).
 */
export function buildDictionary(locale) {
  const entries = {};
  const add = (en, local) => {
    if (typeof en !== 'string' || typeof local !== 'string') return;
    const key = en.trim();
    if (!key || key === local || !/[a-z]/i.test(key) || /\{\d\}|%/.test(key) || /\{\d\}/.test(local)) return;
    entries[key] = local.trim();
  };
  const enPack = itemPack('en');
  const pack = itemPack(locale);
  if (enPack && pack) {
    for (const [id, text] of Object.entries(enPack.clientStringsById ?? {})) {
      if (text.length <= 48 && !text.includes('\n')) add(text, pack.clientStringsById?.[id]);
    }
  }
  const terms = loadTerms(locale);
  const en = loadTerms('en');
  if (terms) {
    for (const [enName, local] of Object.entries(terms.names)) add(enName, local);
    for (const [id, lines] of Object.entries(terms.passives)) {
      const enLines = en.passives[id];
      if (!enLines) continue;
      lines.forEach((line, i) => add(enLines[i], line));
    }
  }
  const uiFile = path.join(ROOT, 'data', 'ui', `${locale}.json`);
  if (fs.existsSync(uiFile)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(uiFile, 'utf8')))) add(k, v);
  return entries;
}

export function writeDictionary(locale) {
  const file = statePath('window-language', `${locale}.json`);
  const entries = buildDictionary(locale);
  writeJson(file, { locale, entries });
  return { file: file.split(path.sep).join('/'), count: Object.keys(entries).length };
}

/** Long-lived PowerShell process that turns phrases into PNGs; results are cached on disk. */
export class TextRenderer {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.queue = new Map();
    this.nextId = 1;
    this.index = new Map();
  }

  #start() {
    if (this.child) return;
    this.child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'text-renderer.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.setDefaultEncoding('utf8');
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      let reply;
      try { reply = JSON.parse(line.replace(/^﻿/, '')); } catch { return; }
      const waiter = this.queue.get(reply.id);
      if (!waiter) return;
      this.queue.delete(reply.id);
      if (reply.error) waiter.reject(new Error(reply.error)); else waiter.resolve(reply);
    });
    readline.createInterface({ input: this.child.stderr }).on('line', line => this.log(`text renderer: ${line}`));
    this.child.on('exit', () => {
      for (const waiter of this.queue.values()) waiter.reject(new Error('Text renderer stopped.'));
      this.queue.clear();
      this.child = null;
    });
  }

  /** Renders { key, text, height, bold } for `locale`; returns { key, path, w, h }. */
  async render({ key, text, height, bold }, locale) {
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 20);
    const dir = statePath('window-language', 'images');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${hash}.png`);
    const known = this.index.get(hash);
    if (known && fs.existsSync(file)) return { key, path: file.split(path.sep).join('/'), ...known };
    this.#start();
    const id = this.nextId++;
    const size = await new Promise((resolve, reject) => {
      this.queue.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, text, height: Math.max(8, Math.round(height)), bold: Boolean(bold), font: WINDOW_FONTS[locale] ?? 'Segoe UI', out: file }) + '\n');
    });
    this.index.set(hash, { w: size.w, h: size.h });
    return { key, path: file.split(path.sep).join('/'), w: size.w, h: size.h };
  }

  close() { this.child?.stdin.end(); }
}
