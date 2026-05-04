export const getApiUrl = (path: string): string => {
  if (typeof window === 'undefined') return path;

  const url = new URL(path, window.location.href);
  url.username = '';
  url.password = '';
  return url.toString();
};

export const getApiHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};

  const currentUrl = new URL(window.location.href);
  const credentialedUrl = [currentUrl, ...Array.from(document.scripts, script => new URL(script.src, window.location.href))]
    .find(url => url.protocol === currentUrl.protocol && url.host === currentUrl.host && (url.username || url.password));

  if (!credentialedUrl) return {};

  return {
    Authorization: `Basic ${window.btoa(`${decodeURIComponent(credentialedUrl.username)}:${decodeURIComponent(credentialedUrl.password)}`)}`
  };
};
