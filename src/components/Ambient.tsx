import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import type { AmbientPalette } from '../lib/palette';

interface AmbientProps {
  palette: AmbientPalette;
}

interface Layer {
  id: number;
  palette: AmbientPalette;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A fixed, very soft wash of the current sleeve's colours. Two layers are kept
 * so a track change crossfades instead of snapping, and the whole field drifts
 * slowly enough to feel like light rather than animation.
 */
export function Ambient({ palette }: AmbientProps) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, palette }]);
  const nextId = useRef(1);

  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1].palette === palette) return prev;
      return [...prev.slice(-1), { id: nextId.current++, palette }];
    });
  }, [palette]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', palette.base);
  }, [palette.base]);

  return (
    <div className="ambient" aria-hidden="true">
      {layers.map((layer) => (
        <motion.div
          key={layer.id}
          className="ambient-layer"
          style={
            {
              '--ambient-base': layer.palette.base,
              '--ambient-a': layer.palette.tints[0],
              '--ambient-b': layer.palette.tints[1],
              '--ambient-c': layer.palette.tints[2],
            } as CSSProperties
          }
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        />
      ))}
      <div className="ambient-grain" />
    </div>
  );
}
