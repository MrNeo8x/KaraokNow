import { requestBlob } from './api';

/** Downloads an authorised file (e.g. report CSV) through the API with the bearer token and saves it locally. */
export async function downloadFile(path: string, fileName: string, token: string, tenant?: string): Promise<void> {
  const blob = await requestBlob(path, token, tenant);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
