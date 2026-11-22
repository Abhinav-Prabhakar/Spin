interface GlyphProps {
  size?: number;
  className?: string;
}

export function PlayGlyph({ size = 24, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M8.4 4.94c0-.91.99-1.48 1.78-1.03l11.08 6.3c.79.45.79 1.61 0 2.06l-11.08 6.3c-.79.45-1.78-.12-1.78-1.03V4.94Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function PauseGlyph({ size = 24, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="6.4" y="4.6" width="3.8" height="14.8" rx="1.7" fill="currentColor" />
      <rect x="13.8" y="4.6" width="3.8" height="14.8" rx="1.7" fill="currentColor" />
    </svg>
  );
}

export function PrevGlyph({ size = 24, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5.1 5.1c0-.61.5-1.1 1.1-1.1s1.1.49 1.1 1.1v5.28l7.85-5.55c.73-.52 1.75 0 1.75.88v12.58c0 .88-1.02 1.4-1.75.88L7.3 13.62v5.28c0 .61-.49 1.1-1.1 1.1s-1.1-.49-1.1-1.1V5.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function NextGlyph({ size = 24, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M18.9 5.1c0-.61-.5-1.1-1.1-1.1s-1.1.49-1.1 1.1v5.28L8.85 4.83c-.73-.52-1.75 0-1.75.88v12.58c0 .88 1.02 1.4 1.75.88l7.85-5.55v5.28c0 .61.49 1.1 1.1 1.1s1.1-.49 1.1-1.1V5.1Z"
        fill="currentColor"
      />
    </svg>
  );
}
