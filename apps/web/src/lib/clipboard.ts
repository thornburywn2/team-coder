// Copy text to the clipboard, working even when the portal is served over plain
// HTTP on a LAN/VPN IP. `navigator.clipboard` only exists in a *secure context*
// (HTTPS or localhost), so on http://10.0.0.1:6300 it's undefined and the copy
// silently no-ops — which is exactly the bug coders hit copying their token. We
// try the modern API first, then fall back to a hidden <textarea> + execCommand.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
