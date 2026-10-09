const keys = new Set();
const touch = { left: false, right: false, brake: false, nitro: false, horn: false };
const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export const isTouch = window.matchMedia('(pointer: coarse)').matches;

const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  keys.add(e.code);
  if (BLOCK.includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

export function setupTouch(root) {
  root.querySelectorAll('[data-touch]').forEach((btn) => {
    const k = btn.dataset.touch;
    const on = (e) => { e.preventDefault(); touch[k] = true; btn.classList.add('on'); };
    const off = () => { touch[k] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, off));
  });
}

export function readInput() {
  const left = keys.has('ArrowLeft') || keys.has('KeyA') || touch.left;
  const right = keys.has('ArrowRight') || keys.has('KeyD') || touch.right;
  const brake = keys.has('ArrowDown') || keys.has('KeyS') || touch.brake;
  // On touch screens the car accelerates on its own unless braking.
  const gas = keys.has('ArrowUp') || keys.has('KeyW') || (isTouch && !brake);
  const nitro = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Space') || touch.nitro;
  const horn = keys.has('KeyH') || touch.horn;
  return { steer: (right ? 1 : 0) - (left ? 1 : 0), gas, brake, nitro, horn };
}
