import os from 'node:os';
import { VERSION } from '../update/updater.mjs';

/** Classifies CLI failures without exposing its output as an answer. */
export function classifyFailure(texts, { exitCode, eventCount = 0 } = {}) {
  const text = texts.filter(Boolean).join('\n');
  if (/\/login|not logged in|log ?in|invalid api key|unauthori[sz]ed|\b401\b|authenticat|OAuth.*expired/i.test(text)) return 'AGENT_SIGNED_OUT';
  if (/\b429\b|rate[ _-]?limit|usage[ _-]?limit|quota|insufficient_quota/i.test(text)) return 'AGENT_RATE_LIMITED';
  if (/model.{0,80}(not found|not available|does not exist|unsupported|not supported)|unsupported model|invalid model/i.test(text)) return 'AGENT_MODEL_UNAVAILABLE';
  if (/sandbox.{0,100}(fail|error|setup|not initialized|unavailable)|CreateProcessWithToken|bwrap:/i.test(text)) return 'AGENT_SANDBOX';
  if (/TOML|config.{0,80}(invalid|parse|error)|unexpected argument|unknown (argument|option)/i.test(text)) return 'AGENT_CONFIG';
  if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network error|stream disconnected|connection.{0,40}(failed|reset|refused|closed)|certificate|TLS handshake/i.test(text)) return 'AGENT_NETWORK';
  if (exitCode === 0) return eventCount ? 'AGENT_PROTOCOL' : 'AGENT_NO_RESPONSE';
  return 'AGENT_FAILED';
}

/** Only bounded, scrubbed diagnostics reach the panel, saved chats or a copied report. */
export function redactDiagnosticText(value, home = process.env.USERPROFILE || os.homedir()) {
  let text = String(value ?? '')
    .replace(/^(\s*(?:set-)?cookie\s*:\s*).*$/gim, '$1[redacted]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|api_key|access_token|refresh_token)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/(["']?\b(?:access[_ -]?token|refresh[_ -]?token|session[_ -]?token|client[_ -]?secret|api[_ -]?key|authorization|cookie|password|token|secret)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
  if (home) {
    for (const prefix of new Set([home, home.replaceAll('\\', '/')])) {
      text = text.replace(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '%USERPROFILE%');
    }
  }
  // Windows can return 8.3 aliases or escaped paths in a CLI's error output.
  text = text.replace(/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/gi, '%USERPROFILE%');
  return text.slice(0, 2400);
}

export function agentDiagnostic({ provider, command, version, minimumVersion, exitCode, signal, details = [], events = {} }) {
  return {
    appVersion: VERSION,
    provider, ...(version ? { version } : {}), ...(minimumVersion ? { minimumVersion } : {}),
    ...(provider === 'codex' && minimumVersion ? { updateCommand: 'npm install -g @openai/codex' } : {}),
    ...(command ? { executable: redactDiagnosticText(command) } : {}),
    ...(exitCode != null ? { exitCode } : {}), ...(signal ? { signal } : {}),
    log: '%LOCALAPPDATA%\\pob-ai\\logs\\service.log',
    ...(details.filter(Boolean).length ? { details: redactDiagnosticText(details.filter(Boolean).slice(-5).join('\n')) } : {}),
    ...(Object.keys(events).length ? { events } : {}),
  };
}
