import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, Disc3, Link2, X } from 'lucide-react';
import type { UploadItem } from '../hooks/useUploads';

interface UploadTrayProps {
  items: UploadItem[];
  onCancel: (id: string) => void;
}

export function UploadTray({ items, onCancel }: UploadTrayProps) {
  if (items.length === 0) return null;
  const visible = items.slice(-5);

  return (
    <aside className="upload-tray" aria-live="polite" aria-label="Uploads">
      <AnimatePresence initial={false}>
        {visible.map((item) => {
          const percent = Math.round(item.progress * 100);
          const resolving = item.state === 'resolving';
          const analyzing = item.state === 'analyzing';
          const label = resolving
            ? 'link'
            : analyzing
              ? '···'
              : item.state === 'error'
                ? '!'
                : item.state === 'done'
                  ? ''
                  : `${percent}%`;
          return (
            <motion.div
              key={item.id}
              className={`upload-item is-${item.state} is-${item.kind}`}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.22 }}
            >
              <span className="upload-art">
                {item.state === 'done' ? (
                  <Check size={15} strokeWidth={2.2} />
                ) : item.state === 'error' ? (
                  <AlertCircle size={15} strokeWidth={1.9} />
                ) : resolving ? (
                  <Link2 size={14} strokeWidth={1.7} />
                ) : (
                  <>
                    <span
                      className="upload-ring"
                      style={
                        {
                          '--progress': `${Math.max(4, item.progress * 360)}deg`,
                        } as React.CSSProperties
                      }
                    />
                    <Disc3 size={14} strokeWidth={1.6} />
                  </>
                )}
              </span>
              <div className="upload-body">
                <span className="upload-name" title={item.name}>
                  {item.name}
                </span>
                <span className="upload-track">
                  <span
                    className="upload-fill"
                    style={{
                      width: `${resolving || analyzing ? 12 : percent}%`,
                    }}
                  />
                </span>
              </div>
              <span className="upload-state" aria-hidden="true">
                {label}
              </span>
              {item.state !== 'done' && (
                <button
                  type="button"
                  className="upload-cancel"
                  onClick={() => onCancel(item.id)}
                  aria-label={`Cancel ${item.kind === 'link' ? 'link' : 'upload of'} ${item.name}`}
                  title="Cancel"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </aside>
  );
}
