import type { User } from '@shared/types';
import { avatarBackground } from '../lib/media';

interface AvatarProps {
  user: User;
  size?: number;
  self?: boolean;
  className?: string;
}

export function Avatar({ user, size = 28, self = false, className = '' }: AvatarProps) {
  return (
    <span
      className={`avatar ${self ? 'is-self' : ''} ${className}`}
      title={`${user.name}${self ? ' · you' : ''}`}
      style={{
        width: size,
        height: size,
        background: avatarBackground(user.hue),
      }}
    >
      <span className="avatar-shine" />
    </span>
  );
}
