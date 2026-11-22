/** Where the realtime API and media live. Empty on localhost, so Vite proxies. */
const configured = import.meta.env.VITE_API_ORIGIN as string | undefined;

export const API_ORIGIN = (configured ?? '').replace(/\/+$/, '');

/** Vite's base path, without the trailing slash: '' locally, '/Spin' on Pages. */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

export function wsUrl(path: string): string {
  const base = API_ORIGIN || window.location.origin;
  return `${base.replace(/^http/i, 'ws')}${path}`;
}

export function appPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}
