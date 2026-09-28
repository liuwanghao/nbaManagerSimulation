import { useEffect, useId, useRef } from "react";

type BasketballSeamLoaderProps = {
  compact?: boolean;
};

export function BasketballSeamLoader({ compact = false }: BasketballSeamLoaderProps) {
  const loaderRef = useRef<SVGSVGElement>(null);
  const gradientId = `basketball-seam-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const syncVisibility = () => loaderRef.current?.classList.toggle("basketball-seam-loader--paused", document.hidden);
    document.addEventListener("visibilitychange", syncVisibility, { passive: true });
    syncVisibility();
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  return <svg ref={loaderRef} className={`basketball-seam-loader${compact ? " basketball-seam-loader--compact" : ""}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#00e5ff" />
        <stop offset="58%" stopColor="#00e5ff" />
        <stop offset="100%" stopColor="#ff9100" />
      </linearGradient>
    </defs>
    <g className="basketball-seam-bg">
      <circle cx="50" cy="50" r="44" />
      <path d="M50 6V94" />
      <path d="M6 50H94" />
      <path d="M21 16A44 44 0 0 1 21 84" />
      <path d="M79 16A44 44 0 0 0 79 84" />
    </g>
    <path
      className="basketball-seam-flow"
      stroke={`url(#${gradientId})`}
      d="M50 6A44 44 0 1 1 49.999 6 M50 6V94 M6 50H94 M21 16A44 44 0 0 1 21 84 M79 16A44 44 0 0 0 79 84"
    />
  </svg>;
}
