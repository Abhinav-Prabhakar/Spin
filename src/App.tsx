import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Landing } from './components/Landing';
import { Room } from './components/Room';
import { appPath } from './lib/api';
import { parseRoomPath } from './lib/media';

const EASE = [0.22, 1, 0.36, 1] as const;

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

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={code ?? 'landing'}
          className="app-shell"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          {code ? <Room code={code} onHome={home} /> : <Landing onEnter={enter} />}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
