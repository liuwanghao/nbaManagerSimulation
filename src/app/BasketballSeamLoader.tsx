type BasketballSeamLoaderProps = {
  compact?: boolean;
};

export function BasketballSeamLoader({ compact = false }: BasketballSeamLoaderProps) {
  return <svg className={`basketball-seam-loader${compact ? " basketball-seam-loader--compact" : ""}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <g className="basketball-seam-bg">
      <circle cx="50" cy="50" r="44" />
      <path d="M 50,6 L 50,94" />
      <path d="M 6,50 L 94,50" />
      <path d="M 21,16 A 44,44 0 0,1 21,84" />
      <path d="M 79,16 A 44,44 0 0,0 79,84" />
    </g>
    <circle className="basketball-seam-flow basketball-seam-flow--outer" cx="50" cy="50" r="44" />
    <path className="basketball-seam-flow basketball-seam-flow--cross" d="M 50,6 L 50,94" />
    <path className="basketball-seam-flow basketball-seam-flow--cross" d="M 6,50 L 94,50" />
    <path className="basketball-seam-flow basketball-seam-flow--arc" d="M 21,16 A 44,44 0 0,1 21,84" />
    <path className="basketball-seam-flow basketball-seam-flow--arc" d="M 79,16 A 44,44 0 0,0 79,84" />
  </svg>;
}
