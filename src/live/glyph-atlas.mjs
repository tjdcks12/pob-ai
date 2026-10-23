// Glyph atlas pages for the PoB window font (adapter/live/atlas.lua). The window asks for the
// glyphs it is missing at one physical pixel height; a long-lived PowerShell process
// (text-renderer.ps1, GDI+) draws them white on transparent into one PNG page and reports where
// each glyph is. Pages are cached on disk, so a restart does not render them again.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { statePath } from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(here, '../../data/fonts');

// Pretendard em size and baseline as a share of PoB's line height: the same cap height and
// baseline as PoB's Liberation Sans bitmaps (measured from SimpleGraphic/Fonts at 10-64 px).
export const EM = 0.875;
export const BASELINE = 0.8125;
// Bump when the rendering changes so cached pages are drawn again.
const VERSION = 3;

const PRETENDARD = 'Pretendard';
const GENERIC = [PRETENDARD, 'Segoe UI', 'Segoe UI Symbol', 'Malgun Gothic', 'Yu Gothic UI', 'Microsoft JhengHei UI', 'Leelawadee UI', 'Nirmala UI'];
const CJK = { ja: ['Yu Gothic UI', 'Meiryo UI', 'MS Gothic'], zh: ['Microsoft JhengHei UI', 'Microsoft JhengHei', 'MingLiU'], base: ['Malgun Gothic', 'Microsoft JhengHei UI', 'Yu Gothic UI'] };

const isThai = cp => cp >= 0x0e00 && cp <= 0x0e7f;
const isKana = cp => (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff65 && cp <= 0xff9f);
const isHan = cp => (cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0x3400 && cp <= 0x4dbf)
  || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff64) || (cp >= 0xffa0 && cp <= 0xffef) || cp >= 0x20000;

/**
 * Fonts to try for one character cluster, best first; the renderer takes the first that has every
 * character. Pretendard covers Latin, Cyrillic, Hangul and kana. Thai and Han need other fonts,
 * and Han (and kana in Japanese) use the forms of the window language.
 */
export function fontsFor(cluster, group = 'base') {
  const cp = cluster.codePointAt(0);
  const cjk = CJK[group] ?? CJK.base;
  let first = [];
  if (isThai(cp)) first = ['Leelawadee UI', 'Leelawadee', 'Tahoma'];
  else if (isHan(cp) || (isKana(cp) && group !== 'base')) first = cjk;
  return [...new Set([...first, ...GENERIC, ...cjk])];
}

/** Checks and normalises a glyph request from the window; returns null when it is not valid. */
export function atlasRequest(event) {
  const face = event?.face === 'bold' ? 'bold' : event?.face === 'regular' ? 'regular' : null;
  const px = Number(event?.px);
  const group = ['base', 'ja', 'zh'].includes(event?.group) ? event.group : null;
  const clusters = Array.isArray(event?.clusters) ? event.clusters : null;
  if (!face || !group || !clusters || !Number.isInteger(px) || px < 1 || px > 256) return null;
  if (!clusters.length || clusters.length > 4000 || clusters.some(c => typeof c !== 'string' || !c.length || c.length > 32)) return null;
  return { face, px, group, clusters };
}

/** What the renderer is asked to draw: each cluster with its font list, plus the em and baseline. */
export function rendererJob({ face, px, group, clusters }, out) {
  return {
    mode: 'atlas', fontDir: FONT_DIR, out, bold: face === 'bold', px,
    em: Math.round(px * EM * 100) / 100, baseline: Math.floor(px * BASELINE + 0.4),
    glyphs: clusters.map(text => ({ text, fonts: fontsFor(text, group) })),
  };
}

/** Long-lived PowerShell process that runs text-renderer.ps1, one JSON request per line. */
class Renderer {
  constructor(log) {
    this.log = log;
    this.queue = new Map();
    this.nextId = 1;
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

  request(job) {
    this.#start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.queue.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, ...job }) + '\n');
    });
  }

  close() { this.child?.stdin.end(); }
}

export class GlyphAtlas {
  constructor({ log = () => {} } = {}) {
    this.renderer = new Renderer(log);
  }

  /** Renders one page for a request from the window; returns { path, w, h, glyphs }. */
  async render(event) {
    const request = atlasRequest(event);
    if (!request) throw new Error('Bad glyph request.');
    const hash = createHash('sha1').update(JSON.stringify([VERSION, request.face, request.px, request.group, request.clusters])).digest('hex').slice(0, 24);
    const dir = statePath('window-font');
    fs.mkdirSync(dir, { recursive: true });
    const png = path.join(dir, `${hash}.png`);
    const meta = path.join(dir, `${hash}.json`);
    const result = { path: png.split(path.sep).join('/') };
    if (fs.existsSync(png) && fs.existsSync(meta)) {
      try { return { ...result, ...JSON.parse(fs.readFileSync(meta, 'utf8')) }; } catch { /* draw it again */ }
    }
    const page = await this.renderer.request(rendererJob(request, png));
    const metrics = { w: page.w, h: page.h, glyphs: page.glyphs };
    fs.writeFileSync(meta, JSON.stringify(metrics));
    return { ...result, ...metrics };
  }

  close() { this.renderer.close(); }
}
