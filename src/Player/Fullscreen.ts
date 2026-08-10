/**
 * Fullscreen.ts — the Fullscreen API, and why the game offers its own toggle.
 *
 * F11 is the browser's own fullscreen. It works, but it is only a *window*
 * state: the page has no idea it happened, and more importantly the mouse is
 * still a free desktop cursor, so on a multi-monitor setup it slides straight
 * onto the second screen mid-game.
 *
 * The Fullscreen API is different in the way that matters here: the page
 * requests it, so the game knows, and — crucially — the request is a user
 * gesture that can be paired with a pointer-lock request in the same breath.
 * Pointer lock is the only mechanism that actually confines the cursor to the
 * window, on one monitor or six.
 */

/** Is the document currently fullscreen? */
export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.fullscreenElement !== null;
}

/** Can this document go fullscreen at all? */
export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  // An iframe without the `fullscreen` permission reports false here.
  return document.fullscreenEnabled === true;
}

/**
 * Enter fullscreen. Must be called from a user gesture.
 * Returns whether it succeeded, so the caller can tell the player the truth.
 */
export async function enterFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const target = document.documentElement;
  if (!target.requestFullscreen) return false;
  try {
    await target.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement === null) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Already leaving, or the browser refused; nothing useful to do.
  }
}

/** Toggle, returning the state afterwards. */
export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  return enterFullscreen();
}

/** Subscribe to fullscreen changes. Returns an unsubscribe function. */
export function onFullscreenChange(fn: (full: boolean) => void): () => void {
  const handler = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}
