/**
 * Tiny, self-contained confetti burst — no external dependency.
 *
 * Spawns a short-lived full-screen canvas, fires a batch of colourful particles
 * with gravity, and removes itself when they've fallen off-screen. Used by the
 * Progress Gates to celebrate a correct answer. Respects reduced-motion and is a
 * no-op outside the browser, so it's safe to import anywhere.
 *
 * confettiBurst({ particleCount, spread, originY, originX })
 */
export function confettiBurst({
  particleCount = 80,
  spread = 60,          // degrees the cone fans out
  originY = 0.8,        // 0 = top, 1 = bottom of viewport
  originX = 0.5,
} = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#38bdf8", "#a855f7"];
  const cx = originX * W;
  const cy = originY * H;
  const baseAngle = -Math.PI / 2; // straight up
  const spreadRad = (spread * Math.PI) / 180;

  const particles = Array.from({ length: particleCount }, () => {
    const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
    const velocity = 8 + Math.random() * 9;
    return {
      x: cx,
      y: cy,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      size: 5 + Math.random() * 6,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 0,
      ttl: 90 + Math.random() * 40,
    };
  });

  const gravity = 0.28;
  const drag = 0.992;
  let raf = null;

  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.life += 1;
      if (p.life > p.ttl || p.y > H + 40) continue;
      alive = true;
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };

  raf = requestAnimationFrame(tick);

  // Safety net: never leave a stray canvas around.
  setTimeout(() => {
    if (canvas.isConnected) {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  }, 4000);
}

export default confettiBurst;
