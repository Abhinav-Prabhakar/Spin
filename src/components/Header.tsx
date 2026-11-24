import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Link2 } from 'lucide-react';
import type { User } from '@shared/types';
import { Avatar } from './Avatar';
import { Brand } from './Brand';

interface HeaderProps {
  code: string;
  users: User[];
  me: User | null;
  connected: boolean;
  copied: boolean;
  onHome: () => void;
  onCopy: () => void;
  onShare: () => void;
}

export function Header({ code, users, me, connected, copied, onHome, onCopy, onShare }: HeaderProps) {
  const sorted = [...users].sort((a, b) => {
    if (a.id === me?.id) return -1;
    if (b.id === me?.id) return 1;
    return a.name.localeCompare(b.name);
  });
  const visible = sorted.slice(0, 4);
  const hidden = Math.max(0, sorted.length - visible.length);

  return (
    <header className="app-header">
      <Brand onClick={onHome} />

      <button
        type="button"
        className="room-pill"
        onClick={onCopy}
        title={copied ? 'Link copied' : 'Copy invite link'}
        aria-label={`Room ${code}. Copy invite link`}
      >
        <span className={`room-dot ${connected ? 'is-live' : 'is-away'}`} aria-hidden="true" />
        <span className="room-code">{code}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? 'check' : 'copy'}
            className="room-pill-icon"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
          >
            {copied ? <Check size={12} strokeWidth={2.2} /> : <Copy size={12} strokeWidth={1.8} />}
          </motion.span>
        </AnimatePresence>
      </button>

      <div className="header-right">
        <div className="people" aria-label={`${users.length} listening`}>
          <AnimatePresence initial={false}>
            {visible.map((user) => (
              <motion.span
                key={user.id}
                className="people-slot"
                layout
                initial={{ opacity: 0, scale: 0.55 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.55 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <Avatar user={user} self={user.id === me?.id} size={30} />
              </motion.span>
            ))}
          </AnimatePresence>
          {hidden > 0 && (
            <span className="people-more" title={`${hidden} more listening`}>
              +{hidden}
            </span>
          )}
        </div>
        <button type="button" className="invite-btn" onClick={onShare} title="Share invite">
          <Link2 size={15} strokeWidth={1.8} />
          <span>Invite</span>
        </button>
      </div>
    </header>
  );
}
