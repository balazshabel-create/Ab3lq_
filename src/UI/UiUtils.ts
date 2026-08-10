/**
 * UiUtils.ts — small DOM helpers.
 *
 * `el` builds elements with attributes and text in one call, which keeps the UI
 * files readable without pulling in a framework. Text always goes through
 * textContent rather than innerHTML, so a player-supplied name can never inject
 * markup into somebody else's lobby.
 */

/** Create an element with attributes and optional text content. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'id') node.id = value;
    else node.setAttribute(key, value);
  }
  // textContent, never innerHTML: names and species labels are untrusted input.
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Format seconds as m:ss, clamped at zero. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Format seconds as a compact duration ("2m 14s"). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** A labelled row for the settings screen. */
export function settingRow(
  label: string,
  hint: string,
  control: HTMLElement,
  valueNode?: HTMLElement,
): HTMLElement {
  const row = el('div', { class: 'setting' });
  const labelWrap = el('div');
  labelWrap.append(el('div', { class: 'setting-label' }, label));
  if (hint) labelWrap.append(el('span', { class: 'setting-hint' }, hint));
  const controlWrap = el('div', { class: 'setting-control' });
  if (valueNode) controlWrap.append(valueNode);
  controlWrap.append(control);
  row.append(labelWrap, controlWrap);
  return row;
}

/** A toggle switch bound to a getter/setter pair. */
export function toggleControl(
  initial: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const node = el('div', { class: initial ? 'toggle on' : 'toggle' });
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-checked', String(initial));
  node.tabIndex = 0;
  let value = initial;
  const flip = () => {
    value = !value;
    node.classList.toggle('on', value);
    node.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  node.addEventListener('click', flip);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flip();
    }
  });
  return node;
}

/** A range slider with a live value readout. */
export function sliderControl(options: {
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}): { control: HTMLElement; value: HTMLElement } {
  const value = el('div', { class: 'setting-value' }, options.format(options.value));
  const input = el('input', {
    type: 'range',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    value: String(options.value),
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = options.format(v);
    options.onChange(v);
  });
  return { control: input, value };
}

/** A select dropdown. */
export function selectControl<T extends string>(
  options: { value: T; label: string }[],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const select = el('select');
  for (const option of options) {
    const node = el('option', { value: option.value }, option.label);
    if (option.value === current) node.selected = true;
    select.appendChild(node);
  }
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

/** Remove every child of a node. */
export function clearChildren(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Wait a number of milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
