import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'projects' }
  | { name: 'media'; projectId: string }
  | { name: 'review'; projectId: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const match = /^\/p\/([^/]+)\/(media|review)\/?$/.exec(path);
  if (match) {
    const projectId = decodeURIComponent(match[1]);
    return match[2] === 'media' ? { name: 'media', projectId } : { name: 'review', projectId };
  }
  return { name: 'projects' };
}

export function routeHref(route: Route): string {
  if (route.name === 'projects') return '#/';
  return `#/p/${encodeURIComponent(route.projectId)}/${route.name}`;
}

export function navigate(route: Route, replace = false): void {
  const href = routeHref(route);
  if (replace) history.replaceState(null, '', href);
  else if (location.hash !== href) location.hash = href;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

const getHash = () => location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  return parseHash(hash);
}
