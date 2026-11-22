import { useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Play } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { Brand } from './Brand';
import { Orbit } from './Orbit';

interface LandingProps {
  onEnter: (code: string) => void;
}

export function Landing({ onEnter }: LandingProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createRoom = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/rooms'), { method: 'POST' });
      if (!response.ok) throw new Error('Could not start a room.');
      const data = (await response.json()) as { code?: string };
      if (!data.code) throw new Error('Could not start a room.');
      onEnter(data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a room.');
      setBusy(false);
    }
  };

  const updateCode = (value: string) => {
    const fromLink = value.match(/\/r\/([A-Za-z0-9]{4,12})/);
    const next = (fromLink ? fromLink[1] : value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    setCode(next);
    setError(null);
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) {
      setError('Room codes are six characters.');
      return;
    }
    onEnter(code);
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <h1 className="landing-title">
            <span>Listen</span>
            <span>
              together<span className="title-dot">.</span>
            </span>
          </h1>
          <p className="landing-sub">Drop a song. Everyone hears the same beat.</p>

          <div className="landing-actions">
            <button
              type="button"
              className="primary-action"
              onClick={createRoom}
              disabled={busy}
            >
              <span className="primary-icon">
                {busy ? (
                  <LoaderCircle size={16} className="spin" strokeWidth={2} />
                ) : (
                  <Play size={14} fill="currentColor" strokeWidth={0} />
                )}
              </span>
              <span>{busy ? 'Opening a room' : 'Start a room'}</span>
              <ArrowRight size={17} strokeWidth={1.8} className="primary-arrow" />
            </button>

            <form className="join-form" onSubmit={joinRoom}>
              <span className="join-label">or join with a code</span>
              <div className={`join-field ${error ? 'has-error' : ''}`}>
                <input
                  value={code}
                  onChange={(event) => updateCode(event.target.value)}
                  placeholder="ROOM CODE"
                  aria-label="Room code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={6}
                />
                <button
                  type="submit"
                  className="join-submit"
                  disabled={code.length !== 6}
                  aria-label="Join room"
                  title="Join room"
                >
                  <ArrowRight size={16} strokeWidth={2} />
                </button>
              </div>
              <span className={`landing-error ${error ? 'is-visible' : ''}`}>
                {error ?? '\u00A0'}
              </span>
            </form>
          </div>

          <p className="landing-note">No accounts. Just a link.</p>
        </section>

        <section className="landing-visual">
          <Orbit />
        </section>
      </main>
    </div>
  );
}
