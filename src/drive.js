// Google sign-in and Drive metadata, straight from the browser: no backend involved.
//
// Google Identity Services hands the page a short-lived access token (implicit grant), and the
// Drive REST API answers the page directly, since it allows cross-origin requests.

import { FOLDER_MIME } from './kinds.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
/** Names, sizes and folders only: the app never sees file contents. */
export const SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const FILE_FIELDS = 'id,name,mimeType,size,quotaBytesUsed,parents,trashed,webViewLink';

let gisLoading = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Could not load Google sign-in.'));
    };
    document.head.append(script);
  });
  return gisLoading;
}

/** Opens Google's consent popup and resolves with an access token. */
export async function requestAccessToken(clientId) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) reject(new Error(response.error_description || response.error));
        else resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error.message || error.type || 'Sign-in failed.')),
    });
    client.requestAccessToken();
  });
}

export function revokeToken(token) {
  window.google?.accounts?.oauth2?.revoke?.(token, () => {});
}

async function get(token, path, params = {}) {
  const url = new URL(`${API}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      message = (await response.json()).error?.message || message;
    } catch {}
    const error = new Error(`Drive API: ${message}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** The signed-in user and their storage quota (all strings of bytes, `limit` absent if unlimited). */
export function fetchAbout(token) {
  return get(token, 'about', { fields: 'user(displayName,emailAddress),storageQuota' });
}

export function fetchRoot(token) {
  return get(token, 'files/root', { fields: 'id,name,webViewLink' });
}

/**
 * Every file and folder you own, trash included (it counts against the quota), a page at a time.
 * Folders come first: by the time a file arrives its folder is known, so the treemap fills in
 * folder by folder instead of parking files under "Elsewhere" until their folder shows up.
 * `onPage(allSoFar, done)` runs after each page; resolves with the complete list.
 */
export async function fetchAllFiles(token, onPage, { signal } = {}) {
  const files = [];
  const queries = [`'me' in owners and mimeType = '${FOLDER_MIME}'`, `'me' in owners and mimeType != '${FOLDER_MIME}'`];
  for (const [i, q] of queries.entries()) {
    let pageToken;
    do {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await get(token, 'files', {
        q,
        spaces: 'drive',
        pageSize: '1000',
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      });
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
      onPage?.(files, i === queries.length - 1 && !pageToken);
    } while (pageToken);
  }
  return files;
}
