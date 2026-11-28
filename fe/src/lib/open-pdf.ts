import { requestBlob } from './api';

/**
 * Opens a private PDF that needs the Authorization header. The tab is opened synchronously (inside the click) so
 * popup blockers allow it; the blob URL is assigned after download. Falls back to a download if the tab is blocked.
 */
export async function openPrivatePdf(path: string, fileName: string, token: string, tenant?: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const blob = await requestBlob(path, token, tenant);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else { const link = document.createElement('a'); link.href = url; link.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`; link.click(); }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { tab?.close(); throw error; }
}

export function pdfError(file: { type: string; size: number }): string | null {
  if (file.type !== 'application/pdf') return 'Chỉ nhận file PDF.';
  if (file.size > 4 * 1024 * 1024) return 'File PDF lớn hơn 4 MB. Hãy nén hoặc tách file.';
  return null;
}
