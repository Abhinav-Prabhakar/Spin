import { AnimatePresence, motion } from 'framer-motion';

export interface ToastItem {
  id: number;
  message: string;
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-layer" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            className="toast"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="toast-dot" aria-hidden="true" />
            {item.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
