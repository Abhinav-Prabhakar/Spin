import { useCallback, useEffect, useState } from 'react';
import { Landing } from './components/Landing';
import { Room } from './components/Room';
import { appPath } from './lib/api';
import { parseRoomPath } from './lib/media';

export default function App() {
  const [code, setCode] = useState<string | null>(() => parseRoomPath());

  useEffect(() => {
    const onPop = () => setCode(parseRoomPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = code ? `${code} · Spin` : 'Spin — listen together';
  }, [code]);

  const enter = useCallback((next: string) => {
    const clean = next.trim().toUpperCase();
    window.history.pushState({}, '', appPath(`/r/${clean}`));
    setCode(clean);
    window.scrollTo(0, 0);
  }, []);

  const home = useCallback(() => {
    window.history.pushState({}, '', appPath('/'));
    setCode(null);
    window.scrollTo(0, 0);
  }, []);

  if (code) return <Room key={code} code={code} onHome={home} />;
  return <Landing onEnter={enter} />;
}
