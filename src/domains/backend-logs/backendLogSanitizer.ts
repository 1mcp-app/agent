const BEARER_TOKEN = /\b(bearer\s+)([^\s,;]+)/giu;
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|token|oauth[_-]?code)(\s*[:=]\s*)([^\s&,;]+)/giu;
const URL_PASSWORD = /(https?:\/\/[^\s/:@]+:)([^\s/@]+)(@)/giu;

export function sanitizeBackendLogContent(content: string): string {
  return stripTerminalControls(content)
    .replace(URL_PASSWORD, '$1[REDACTED]$3')
    .replace(BEARER_TOKEN, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]');
}

function stripTerminalControls(content: string): string {
  let sanitized = '';
  for (let index = 0; index < content.length; index++) {
    const code = content.charCodeAt(index);
    if (code === 0x1b && content[index + 1] === '[') {
      index += 2;
      while (index < content.length) {
        const sequenceCode = content.charCodeAt(index);
        if (sequenceCode >= 0x40 && sequenceCode <= 0x7e) break;
        index++;
      }
      continue;
    }
    if ((code >= 0 && code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f)) continue;
    sanitized += content[index];
  }
  return sanitized;
}
