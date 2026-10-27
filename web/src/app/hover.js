// Local reference study: Heron uses a 20-frame mask, 580 ms / steps(19),
// and 480 ms label/icon rolls. The longer-than-usual UI duration is retained
// because Ali explicitly requested this exact reference motion.
const MASK_DURATION = 580;
const ROLL_DURATION = 480;
const ROLL_EASE = 'cubic-bezier(.625,.05,0,1)';
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const controllers = new WeakMap();

function node(className, text) {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function rgbOf(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createPixelButton(element, { interactive = true } = {}) {
  if (controllers.has(element)) return controllers.get(element);
  const label =
    element.dataset.pixelLabel ||
    [...element.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .join(' ');
  element.classList.add('pixel-button');
  // An aria-label the markup already carries (e.g. "View estimates, Italian Grand Prix Race") is kept.
  if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', label);
  const window = node('pixel-window');
  const strip = node('pixel-strip');
  window.append(strip);
  const words = node('pixel-label');
  const top = node('pixel-label-top', label);
  const bottom = node('pixel-label-bottom', label);
  words.append(top, bottom);
  const icon = node('pixel-icon');
  const iconTop = node('pixel-icon-top', '→');
  const iconBottom = node('pixel-icon-bottom', '→');
  icon.append(iconTop, iconBottom);
  // data-pixel-icon="none" keeps the label roll but leaves the arrow out of the button.
  if (element.dataset.pixelIcon === 'none') element.replaceChildren(window, words);
  else element.replaceChildren(window, words, icon);
  // Optional per-element colours; the defaults are the original red button.
  const rest = element.dataset.pixelRest || '#e10600',
    active = element.dataset.pixelActive || '#f4f4ef';
  const restInk = element.dataset.pixelRestText || '#ffffff',
    activeInk = element.dataset.pixelActiveText || '#030303';
  let animations = [],
    phase = 'rest',
    inside = false,
    revision = 0;
  let inspectionPhase = null,
    transitionKind = null;

  function dimensions() {
    const { width, height } = element.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const cell = Math.ceil(Math.max((width + 2) / 24, (height + 2) / 6) * dpr) / dpr;
    strip.style.width = `${cell * 24 * 20}px`;
    strip.style.height = `${cell * 6}px`;
  }
  new ResizeObserver(dimensions).observe(element);
  dimensions();

  function cancel() {
    revision++;
    animations.forEach((a) => a.cancel());
    animations = [];
  }
  function settle(entered) {
    cancel();
    phase = entered ? 'entered' : 'rest';
    element.dataset.hoverPhase = phase;
    element.style.backgroundColor = entered ? active : rest;
    element.style.color = entered ? activeInk : restInk;
    strip.style.opacity = '0';
    strip.style.transform = 'translate(0,-50%)';
    top.style.transform = `translateY(${entered ? '-100%' : '0%'})`;
    bottom.style.transform = `translateY(${entered ? '0%' : '100%'})`;
    iconTop.style.transform = `translateX(${entered ? '100%' : '0%'})`;
    iconBottom.style.transform = `translateX(${entered ? '0%' : '-100%'})`;
  }
  function animate(el, frames, duration, easing = ROLL_EASE) {
    const animation = el.animate(frames, { duration, easing, fill: 'both' });
    animation.pause();
    animations.push(animation);
    return animation;
  }
  function prepare(nextPhase) {
    settle(nextPhase === 'exit');
    phase = nextPhase;
    transitionKind = nextPhase;
    element.dataset.hoverPhase = phase;
    strip.style.backgroundColor = nextPhase === 'enter' ? active : rest;
    strip.style.opacity = '1';
    // The static sprite is moved as a composited layer. Its mask position
    // never animates, so there is no per-frame canvas or DOM paint loop.
    const mask = animate(
      strip,
      [{ transform: 'translate(0%,-50%)' }, { transform: 'translate(-95%,-50%)' }],
      MASK_DURATION,
      'steps(19,end)'
    );
    if (nextPhase === 'enter') {
      animate(top, [{ transform: 'translateY(0%)' }, { transform: 'translateY(-100%)' }], ROLL_DURATION);
      animate(bottom, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }], ROLL_DURATION);
      animate(iconTop, [{ transform: 'translateX(0%)' }, { transform: 'translateX(100%)' }], ROLL_DURATION);
      animate(
        iconBottom,
        [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0%)' }],
        ROLL_DURATION
      );
    }
    // Leave the visible duplicate in place on exit. Replacing it at the
    // start caused a text-layer snap even though both strings were equal.

    const start = nextPhase === 'enter' ? rgbOf(restInk) : rgbOf(activeInk);
    const end = nextPhase === 'enter' ? rgbOf(activeInk) : rgbOf(restInk);
    // Source colour transition: 150 ms, circ.in. Explicit samples preserve
    // the circular curve without installing GSAP for this small study.
    const colors = Array.from({ length: 21 }, (_, i) => {
      const t = i / 20,
        p = 1 - Math.sqrt(1 - t * t);
      return { offset: t, color: `rgb(${start.map((v, c) => Math.round(v + (end[c] - v) * p)).join(',')})` };
    });
    animate(element, colors, 150, 'linear');
    return mask;
  }
  function drive(entered) {
    const wanted = entered ? 'enter' : 'exit';
    if (phase === (entered ? 'entered' : 'rest') || phase === wanted) return;
    if (!animations.length) prepare(wanted);
    // Interrupt at the current frame. A brief pass over the button must not
    // queue a complete entrance followed by another complete wipe.
    const direction = transitionKind === wanted ? 1 : -1;
    phase = wanted;
    element.dataset.hoverPhase = phase;
    const id = ++revision;
    const mask = animations[0];
    animations.forEach((animation) => {
      animation.playbackRate = direction;
      animation.play();
    });
    mask.finished
      .then(() => {
        if (revision === id) settle(entered);
      })
      .catch(() => {});
  }
  const controller = {
    enter() {
      inside = true;
      inspectionPhase = null;
      if (!finePointer.matches || reduced.matches) return settle(true);
      drive(true);
    },
    leave() {
      inside = false;
      inspectionPhase = null;
      if (!finePointer.matches || reduced.matches) return settle(false);
      drive(false);
    },
    seek(nextPhase, elapsed = 0) {
      if (nextPhase === 'rest' || nextPhase === 'entered') {
        if (inspectionPhase !== nextPhase) settle(nextPhase === 'entered');
        inspectionPhase = nextPhase;
        return;
      }
      if (inspectionPhase !== nextPhase) prepare(nextPhase);
      inspectionPhase = nextPhase;
      animations.forEach((a) => {
        a.currentTime = Math.max(0, Math.min(elapsed, a.effect.getTiming().duration));
      });
    },
  };
  if (interactive) {
    element.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch' && finePointer.matches) controller.enter();
    });
    element.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch' && finePointer.matches) controller.leave();
    });
    element.addEventListener('focus', () => {
      if (element.matches(':focus-visible')) settle(true);
    });
    element.addEventListener('blur', () => {
      if (!inside) settle(false);
    });
    // The queries are module-level, so the listeners are released once the button leaves the document.
    const lifetime = new AbortController();
    const live = () => {
      if (element.isConnected) return true;
      lifetime.abort();
      return false;
    };
    reduced.addEventListener('change', () => live() && settle(inside), { signal: lifetime.signal });
    finePointer.addEventListener(
      'change',
      () => {
        if (!live()) return;
        inside = false;
        settle(false);
      },
      { signal: lifetime.signal }
    );
  }
  settle(false);
  controllers.set(element, controller);
  return controller;
}

document
  .querySelectorAll('a.button-light,button.button-light,a.button-grey,button.button-grey')
  .forEach((button) => createPixelButton(button));
