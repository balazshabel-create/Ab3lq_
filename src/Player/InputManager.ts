/**
 * InputManager.ts — keyboard, mouse and pointer lock.
 *
 * Produces the InputAction bitmask the server consumes. Deliberately thin: it
 * reports *intent*, never outcomes, so a modified client can ask to attack but
 * cannot decide whether the attack lands.
 */

import { InputAction } from '../Networking/Protocol';

/** The action bindings, exposed so the settings screen can display them. */
export interface Binding {
  action: keyof typeof BINDING_ACTIONS | 'forward' | 'back' | 'left' | 'right';
  keys: string[];
  label: string;
  /** Shown in the controls list. */
  description: string;
}

const BINDING_ACTIONS = {
  sprint: InputAction.Sprint,
  jump: InputAction.Jump,
  whistle: InputAction.Whistle,
  eat: InputAction.Eat,
  attack: InputAction.Attack,
  submerge: InputAction.Submerge,
  climbUp: InputAction.ClimbUp,
  climbDown: InputAction.ClimbDown,
  ability: InputAction.Ability,
  listen: InputAction.Listen,
  focus: InputAction.Focus,
  fly: InputAction.Fly,
  ascend: InputAction.Ascend,
  descend: InputAction.Descend,
} as const;

export const DEFAULT_BINDINGS: Binding[] = [
  { action: 'forward', keys: ['KeyW', 'ArrowUp'], label: 'W', description: 'Move forward' },
  { action: 'back', keys: ['KeyS', 'ArrowDown'], label: 'S', description: 'Move back' },
  { action: 'left', keys: ['KeyA', 'ArrowLeft'], label: 'A', description: 'Strafe left' },
  { action: 'right', keys: ['KeyD', 'ArrowRight'], label: 'D', description: 'Strafe right' },
  { action: 'sprint', keys: ['ShiftLeft', 'ShiftRight'], label: 'Shift', description: 'Sprint (costs stamina)' },
  { action: 'jump', keys: ['Space'], label: 'Space', description: 'Jump' },
  { action: 'whistle', keys: ['KeyQ'], label: 'Q', description: 'WHISTLE — do this every minute' },
  { action: 'eat', keys: ['KeyE'], label: 'E', description: 'Eat / graze' },
  { action: 'attack', keys: [], label: 'Left click', description: 'Bite / attack' },
  { action: 'submerge', keys: ['KeyC'], label: 'C', description: 'Submerge (water animals)' },
  { action: 'climbUp', keys: ['KeyR'], label: 'R', description: 'Climb up' },
  { action: 'climbDown', keys: ['KeyF'], label: 'F', description: 'Climb down' },
  { action: 'ability', keys: ['KeyX'], label: 'X', description: 'Signature ability' },
  { action: 'listen', keys: ['KeyG'], label: 'G', description: 'Listen (hunter)' },
  { action: 'focus', keys: [], label: 'Right click', description: 'Focus / zoom' },
  { action: 'fly', keys: ['KeyV'], label: 'V', description: 'Take off / land (flyers)' },
  { action: 'ascend', keys: ['KeyR'], label: 'R', description: 'Ascend (flying)' },
  { action: 'descend', keys: ['KeyF'], label: 'F', description: 'Descend (flying)' },
];

export interface InputState {
  /** Local-space movement, -1..1 on each axis. */
  moveForward: number;
  moveRight: number;
  /** Accumulated mouse delta since the last read, in radians. */
  lookX: number;
  lookY: number;
  /** Accumulated wheel delta. */
  zoom: number;
  actions: number;
}

export class InputManager {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private locked = false;
  private enabled = false;
  private lastLockAttempt = 0;
  private lockRejected = false;
  private canvas: HTMLElement;
  private sensitivity = 0.0022;
  /** Actions that fire once per press rather than every frame. */
  private pressed = new Set<string>();
  private consumedOneShots = 0;

  private listeners: { target: EventTarget; type: string; fn: EventListener }[] = [];

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind(): void {
    const add = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.listeners.push({ target, type, fn });
    };

    add(window, 'keydown', ((e: KeyboardEvent) => {
      if (!this.enabled) return;
      // Do not swallow browser shortcuts or typing in a text field.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      /*
       * Also treat a keypress as a chance to re-take pointer lock.
       *
       * The browser drops the lock whenever the player presses Escape, and it
       * will only give it back on a fresh user gesture. Without this the cursor
       * silently becomes free again mid-round — which on a multi-monitor setup
       * means it wanders onto the other screen and clicks land in another
       * window.
       */
      if (!this.locked) void this.requestLock();
      // Space would otherwise scroll the page.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }) as EventListener);

    add(window, 'keyup', ((e: KeyboardEvent) => {
      this.keys.delete(e.code);
    }) as EventListener);

    add(window, 'blur', (() => {
      // Losing focus must not leave the player sprinting forever.
      this.keys.clear();
      this.mouseButtons.clear();
    }) as EventListener);

    add(this.canvas, 'mousedown', ((e: MouseEvent) => {
      if (!this.enabled) return;
      this.mouseButtons.add(e.button);
      if (e.button === 2) e.preventDefault();
      // Any click is a user gesture, which is the only moment a browser will
      // grant pointer lock — so every click is a chance to re-confine the mouse.
      if (!this.locked) void this.requestLock();
    }) as EventListener);

    add(window, 'mouseup', ((e: MouseEvent) => {
      this.mouseButtons.delete(e.button);
    }) as EventListener);

    add(this.canvas, 'contextmenu', ((e: Event) => {
      // Right-click is "focus", so the browser menu must not appear.
      if (this.enabled) e.preventDefault();
    }) as EventListener);

    add(window, 'mousemove', ((e: MouseEvent) => {
      if (!this.enabled) return;
      /*
       * Mouse movement always turns the camera, whether or not the pointer is
       * locked.
       *
       * Pointer lock is still requested on click because it is the better
       * experience — the cursor disappears and cannot hit the window edge. But
       * it is unavailable in some contexts (most often an iframe that was not
       * granted the permission), and requiring a held button as a fallback made
       * the game feel broken. Since the HUD is entirely `pointer-events: none`
       * during a round, there is nothing on screen the free cursor needs to
       * click, so simply always looking is both safe and what players expect.
       */
      let dx = e.movementX;
      let dy = e.movementY;
      /*
       * Without pointer lock, movementX/Y can spike enormously when the cursor
       * re-enters the window or the browser coalesces events. Clamp per event so
       * a stray jump cannot spin the camera through several revolutions.
       */
      if (!this.locked) {
        dx = Math.max(-140, Math.min(140, dx));
        dy = Math.max(-140, Math.min(140, dy));
      }
      this.lookX += dx * this.sensitivity;
      this.lookY -= dy * this.sensitivity;
    }) as EventListener);

    add(this.canvas, 'wheel', ((e: WheelEvent) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY) * 0.6;
    }) as EventListener);

    add(document, 'pointerlockchange', (() => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.lockRejected = false;
    }) as EventListener);

    add(document, 'pointerlockerror', (() => {
      // Fires when the document is not allowed to lock at all.
      this.lockRejected = true;
    }) as EventListener);
  }

  /**
   * Ask for pointer lock — the only way to stop the cursor leaving the window.
   *
   * Pointer lock both hides the cursor and confines it, delivering relative
   * deltas instead of a screen position. That is what prevents the mouse from
   * sliding onto a second monitor while playing, in fullscreen or otherwise.
   *
   * Browsers only grant it from a user gesture, and impose a short cooldown
   * after a lock is released with Escape, so a rejected request is normal and
   * must not be treated as an error. Requests are rate-limited so a held key
   * does not hammer the API.
   */
  async requestLock(): Promise<void> {
    if (this.locked) return;
    /*
     * Deliberately not gated on `enabled`.
     *
     * The lock has to be taken on the click that *starts* the round, because
     * that click is the user gesture the browser requires — by the time the
     * round is actually running, eight seconds of intro later, there is no
     * gesture left to spend. Locking slightly early is harmless: the look
     * handler still ignores mouse movement until input is enabled.
     */
    const now = performance.now();
    if (now - this.lastLockAttempt < 400) return;
    this.lastLockAttempt = now;
    try {
      await this.canvas.requestPointerLock();
      this.lockRejected = false;
    } catch {
      // Either no user gesture, still inside the post-Escape cooldown, or the
      // document is not permitted to lock at all (an iframe without the
      // `pointer-lock` permission). The look fallback keeps the game playable.
      this.lockRejected = true;
    }
  }

  /**
   * True if the last attempt to lock was refused.
   * The HUD uses this to explain what the player can and cannot expect.
   */
  get lockUnavailable(): boolean {
    return this.lockRejected;
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Enable or disable input entirely (menus disable it). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.mouseButtons.clear();
      this.lookX = 0;
      this.lookY = 0;
      this.releaseLock();
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setSensitivity(value: number): void {
    this.sensitivity = Math.max(0.0004, Math.min(0.01, value));
  }

  get currentSensitivity(): number {
    return this.sensitivity;
  }

  private isDown(keys: string[]): boolean {
    for (const key of keys) if (this.keys.has(key)) return true;
    return false;
  }

  private wasPressed(keys: string[]): boolean {
    for (const key of keys) if (this.pressed.has(key)) return true;
    return false;
  }

  private bindingKeys(action: string): string[] {
    return DEFAULT_BINDINGS.find((b) => b.action === action)?.keys ?? [];
  }

  /**
   * Read the current input state and clear per-frame accumulators.
   *
   * `canFly` and `isFlying` change what R/F mean — for a flyer they are
   * ascend/descend, for a climber they are climb up/down. One key doing the
   * contextually obvious thing beats two keys nobody remembers.
   */
  read(context: { canFly: boolean; isFlying: boolean }): InputState {
    let actions = InputAction.None;

    if (this.isDown(this.bindingKeys('sprint'))) actions |= InputAction.Sprint;
    if (this.isDown(this.bindingKeys('jump'))) actions |= InputAction.Jump;
    if (this.isDown(this.bindingKeys('submerge'))) actions |= InputAction.Submerge;

    // One-shot actions: only on the frame the key goes down, so holding Q does
    // not whistle sixty times a second.
    if (this.wasPressed(this.bindingKeys('whistle'))) actions |= InputAction.Whistle;
    if (this.wasPressed(this.bindingKeys('ability'))) actions |= InputAction.Ability;
    if (this.wasPressed(this.bindingKeys('listen'))) actions |= InputAction.Listen;
    if (this.wasPressed(this.bindingKeys('fly'))) actions |= InputAction.Fly;

    // Eating is held, so the server can cancel the meal when you move.
    if (this.isDown(this.bindingKeys('eat'))) actions |= InputAction.Eat;

    // Context-sensitive vertical keys.
    const upKeys = ['KeyR'];
    const downKeys = ['KeyF'];
    if (context.canFly && context.isFlying) {
      if (this.isDown(upKeys)) actions |= InputAction.Ascend;
      if (this.isDown(downKeys)) actions |= InputAction.Descend;
    } else {
      if (this.isDown(upKeys)) actions |= InputAction.ClimbUp;
      if (this.isDown(downKeys)) actions |= InputAction.ClimbDown;
    }

    // Mouse.
    if (this.mouseButtons.has(0)) actions |= InputAction.Attack;
    if (this.mouseButtons.has(2)) actions |= InputAction.Focus;

    let forward = 0;
    let right = 0;
    if (this.isDown(this.bindingKeys('forward'))) forward += 1;
    if (this.isDown(this.bindingKeys('back'))) forward -= 1;
    if (this.isDown(this.bindingKeys('right'))) right += 1;
    if (this.isDown(this.bindingKeys('left'))) right -= 1;

    // Normalise so diagonal movement is not faster.
    const mag = Math.hypot(forward, right);
    if (mag > 1) {
      forward /= mag;
      right /= mag;
    }

    const state: InputState = {
      moveForward: forward,
      moveRight: right,
      lookX: this.lookX,
      lookY: this.lookY,
      zoom: this.zoom,
      actions,
    };

    // Clear the per-frame accumulators.
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.pressed.clear();
    this.consumedOneShots++;

    return state;
  }

  /** Is a raw key currently held? Used for debug toggles. */
  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Frames read, for diagnostics. */
  get framesRead(): number {
    return this.consumedOneShots;
  }

  dispose(): void {
    for (const { target, type, fn } of this.listeners) target.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.releaseLock();
  }
}
