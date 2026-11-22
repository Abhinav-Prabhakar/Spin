import { PlayGlyph } from './Glyphs';

interface BrandProps {
  onClick?: () => void;
  quiet?: boolean;
}

export function Brand({ onClick, quiet = false }: BrandProps) {
  const content = (
    <>
      <span className="brand-mark">
        <PlayGlyph size={12} />
      </span>
      <span className="brand-word">spin</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`brand ${quiet ? 'is-quiet' : ''}`}
        onClick={onClick}
        aria-label="Leave room"
        title="Leave room"
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`brand ${quiet ? 'is-quiet' : ''}`} aria-label="Spin">
      {content}
    </span>
  );
}
