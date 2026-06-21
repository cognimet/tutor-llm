import React, { useEffect, useRef } from "react";

/**
 * Animated streak flame (spec §11.2). A small canvas that emits rising
 * particles; spawn rate scales with the streak length. `isJunior` switches the
 * palette to whimsical multi-colour magic sparks.
 */
export default function StreakFlame({ streakDays = 0, isJunior = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let animationId;

    canvas.width = 120;
    canvas.height = 120;

    const particles = [];
    const colorTheme = isJunior
      ? ["#f59e0b", "#fbbf24", "#60a5fa", "#38bdf8"]
      : ["#ef4444", "#f97316", "#f59e0b", "#ef4444"];

    class Particle {
      constructor() {
        this.x = canvas.width / 2 + (Math.random() - 0.5) * 20;
        this.y = canvas.height - 20;
        this.size = Math.random() * 8 + 4;
        this.speedY = Math.random() * 2 + 1.5;
        this.speedX = (Math.random() - 0.5) * 1.5;
        this.color = colorTheme[Math.floor(Math.random() * colorTheme.length)];
        this.alpha = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
      }
      update() {
        this.y -= this.speedY;
        this.x += this.speedX;
        if (this.size > 0.2) this.size -= 0.1;
        this.alpha -= this.decay;
      }
      draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0, this.size), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const spawn = () => {
      const n = Math.min(6, Math.floor(streakDays / 3) + 2);
      for (let i = 0; i < n; i++) particles.push(new Particle());
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      spawn();
      for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
        if (particles[i].alpha <= 0) { particles.splice(i, 1); i--; }
      }
      const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height - 20, 5,
        canvas.width / 2, canvas.height - 20, 30,
      );
      gradient.addColorStop(0, isJunior ? "rgba(96, 165, 250, 0.4)" : "rgba(239, 68, 68, 0.4)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.beginPath();
      ctx.fillStyle = gradient;
      ctx.arc(canvas.width / 2, canvas.height - 20, 30, 0, Math.PI * 2);
      ctx.fill();
      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [streakDays, isJunior]);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <canvas ref={canvasRef} className="z-10" />
      <div className="absolute bottom-5 z-20 text-center">
        <span className="block text-2xl font-black leading-none text-slate-800 dark:text-white">{streakDays}</span>
        <span className="text-[9px] font-black uppercase leading-none tracking-wider text-slate-400">DAYS</span>
      </div>
    </div>
  );
}
