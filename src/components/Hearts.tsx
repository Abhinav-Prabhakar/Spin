import { AnimatePresence, motion } from 'framer-motion';
import { Heart } from 'lucide-react';
import type { Reaction } from '@shared/types';

export function Hearts({ reactions }: { reactions: Reaction[] }) {
  return (
    <div className="hearts-layer" aria-hidden="true">
      <AnimatePresence>
        {reactions.map((reaction, index) => {
          const left = 50 + ((reaction.id * 37) % 26) - 13 + (index % 2 === 0 ? -3 : 3);
          return (
            <motion.span
              key={reaction.id}
              className="floating-heart"
              style={{ left: `${left}%`, color: `hsl(${reaction.user.hue} 72% 56%)` }}
              initial={{ opacity: 0, y: 0, scale: 0.4, rotate: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: -260,
                x: [0, 14, -8, 6],
                scale: [0.5, 1.15, 1, 0.9],
                rotate: [0, -8, 8, -4],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 3.1, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
            >
              <Heart size={18 + ((reaction.id * 7) % 8)} fill="currentColor" strokeWidth={0} />
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
