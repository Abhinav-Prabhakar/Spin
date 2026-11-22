/** Per-device download cap. Larger tracks stream straight from the source. */
export const LINK_DOWNLOAD_LIMIT = 32 * 1024 * 1024;

export class LinkDownloadError extends Error {
  code: 'too-large' | 'failed' | 'aborted';

  constructor(code: 'too-large' | 'failed' | 'aborted', message: string) {
    super(message);
    this.name = 'LinkDownloadError';
    this.code = code;
  }
}

export function normalizeUrlInput(value: string): string | null {
  let raw = value.trim();
  if (!raw) return null;
  // `example.com:8080` is a host, not a scheme: only keep a real `scheme://`.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && !url.hostname.includes(':')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function downloadAudio(
  url: string,
  options: {
    signal: AbortSignal;
    maxBytes?: number;
    onProgress?: (ratio: number) => void;
  },
): Promise<Blob> {
  const maxBytes = options.maxBytes ?? LINK_DOWNLOAD_LIMIT;

  let response: Response;
  try {
    response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw new LinkDownloadError('aborted', 'cancelled');
    throw new LinkDownloadError('failed', 'The link could not be downloaded.');
  }

  if (!response.ok) {
    throw new LinkDownloadError('failed', 'The link could not be downloaded.');
  }

  const length = Number(response.headers.get('content-length')) || 0;
  if (length > maxBytes) {
    throw new LinkDownloadError('too-large', 'That track is too large to cache.');
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) {
      throw new LinkDownloadError('too-large', 'That track is too large to cache.');
    }
    options.onProgress?.(1);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new LinkDownloadError('too-large', 'That track is too large to cache.');
      }
      chunks.push(new Uint8Array(value));
      if (length > 0) options.onProgress?.(Math.min(1, received / length));
    }
  } catch (err) {
    if (err instanceof LinkDownloadError) throw err;
    if (isAbort(err)) throw new LinkDownloadError('aborted', 'cancelled');
    throw new LinkDownloadError('failed', 'The link stopped downloading.');
  }

  options.onProgress?.(1);
  return new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
