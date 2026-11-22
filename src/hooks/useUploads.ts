import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeAudioFile } from '../lib/analyze';
import { apiUrl } from '../lib/api';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  state: 'analyzing' | 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
}

interface Entry {
  item: UploadItem;
  file: File;
}

interface AbortFlag {
  cancelled: boolean;
  xhr?: XMLHttpRequest;
}

const MAX_BYTES = 20 * 1024 * 1024;
const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.mp4', '.aac', '.wav', '.ogg', '.oga', '.flac', '.webm', '.opus'];
/* Upload one file at a time so the queue keeps the order they were picked in. */
const CONCURRENCY = 1;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function looksLikeAudio(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function useUploads(
  code: string,
  socketId: string | null,
  onToast: (message: string) => void,
) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const aborts = useRef(new Map<string, AbortFlag>());
  const timers = useRef<number[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const current = aborts.current;
    return () => {
      mounted.current = false;
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
      for (const flag of current.values()) {
        flag.cancelled = true;
        flag.xhr?.abort();
      }
      current.clear();
    };
  }, []);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    if (!mounted.current) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const removeLater = useCallback((id: string, delay: number) => {
    const timer = window.setTimeout(() => {
      if (!mounted.current) return;
      setItems((prev) => prev.filter((item) => item.id !== id));
      aborts.current.delete(id);
    }, delay);
    timers.current.push(timer);
  }, []);

  const cancel = useCallback((id: string) => {
    const flag = aborts.current.get(id);
    if (flag) {
      flag.cancelled = true;
      flag.xhr?.abort();
    }
    aborts.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const uploadOne = useCallback(
    async (id: string, file: File) => {
      patch(id, { state: 'analyzing', progress: 0 });
      const fingerprint = await analyzeAudioFile(file);
      const flag = aborts.current.get(id);
      if (!flag || flag.cancelled || !mounted.current) return;

      patch(id, { state: 'uploading', progress: 0.02 });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        flag.xhr = xhr;
        xhr.open('POST', apiUrl(`/api/rooms/${encodeURIComponent(code)}/tracks`));
        xhr.responseType = 'json';
        xhr.timeout = 180_000;

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          patch(id, { progress: 0.02 + (event.loaded / event.total) * 0.95 });
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          const message =
            (xhr.response as { error?: string } | null)?.error ??
            (xhr.status === 413 ? 'That file is too large.' : 'Upload failed.');
          reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error('Could not reach the room.'));
        xhr.onabort = () => reject(new Error('cancelled'));
        xhr.ontimeout = () => reject(new Error('The upload took too long.'));

        const form = new FormData();
        form.append('audio', file, file.name);
        form.append('peaks', JSON.stringify(fingerprint.peaks));
        form.append('duration', String(fingerprint.duration));
        if (socketId) form.append('sid', socketId);
        xhr.send(form);
      });

      patch(id, { state: 'done', progress: 1 });
      removeLater(id, 1200);
    },
    [code, patch, removeLater, socketId],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const accepted: Entry[] = [];
      let rejected = 0;

      for (const file of files) {
        if (!looksLikeAudio(file) || file.size > MAX_BYTES) {
          rejected++;
          continue;
        }
        const id = newId();
        accepted.push({
          file,
          item: { id, name: file.name, size: file.size, progress: 0, state: 'analyzing' },
        });
        aborts.current.set(id, { cancelled: false });
      }

      if (rejected > 0) {
        onToast(rejected === 1 ? 'Only audio files up to 20 MB.' : `${rejected} files skipped — audio only.`);
      }
      if (accepted.length === 0) return;

      setItems((prev) => [...prev, ...accepted.map((entry) => entry.item)]);

      const queue = [...accepted];
      const worker = async () => {
        for (;;) {
          const entry = queue.shift();
          if (!entry) return;
          const id = entry.item.id;
          const flag = aborts.current.get(id);
          if (!flag || flag.cancelled) continue;
          try {
            await uploadOne(id, entry.file);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed.';
            if (message !== 'cancelled') {
              patch(id, { state: 'error', error: message });
              onToast(message);
              removeLater(id, 6000);
            }
          }
        }
      };

      for (let i = 0; i < Math.min(CONCURRENCY, accepted.length); i++) {
        void worker();
      }
    },
    [onToast, patch, removeLater, uploadOne],
  );

  return { items, addFiles, cancel };
}
