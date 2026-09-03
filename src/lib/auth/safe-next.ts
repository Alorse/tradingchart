/**
 * Sanitize the `next` destination of the auth callback.
 *
 * The callback redirects immediately after a successful session exchange, so
 * an attacker-controlled destination lands a *freshly authenticated* user on a
 * look-alike page — a good place to ask them to "reconnect" their exchange API
 * keys. String-concatenating `${origin}${next}` defeats the obvious
 * `https://evil.com` payload but not `@evil.com/x`, which browsers parse as
 * userinfo `origin` at host `evil.com`, nor `//evil.com`, a protocol-relative
 * URL. Only same-origin absolute paths are allowed through; anything else
 * falls back to the app root.
 */

/** Control characters — a raw newline most of all — can split the Location
 *  header or smuggle a second target past the prefix checks. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  // A backslash is treated as a slash by several browsers' URL parsers, so
  // `/\evil.com` is protocol-relative in practice — normalize before checking.
  const candidate = next.replace(/\\/g, "/");
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//")) return "/";
  if (CONTROL_CHARS.test(candidate)) return "/";
  return candidate;
}
