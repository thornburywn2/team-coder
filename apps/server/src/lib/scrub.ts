// Best-effort secret scrubbing for UserPromptSubmit text before it is persisted
// or shown in the feed. Not a security boundary — a guardrail against the common
// case of a coder pasting a key into a prompt. Coders can also opt out of prompt
// capture entirely (hardening).

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[posru]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, // OpenAI/Stripe-style keys
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, // bearer tokens
  /[A-Za-z0-9._%+-]+:[^@\s/]{6,}@/g, // user:pass@ in connection strings
  /\b(?:password|passwd|secret|token|api[_-]?key)\b\s*[=:]\s*\S+/gi,
];

export function scrubSecrets(input: string): string {
  let out = input;
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}
