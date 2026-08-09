export const MAX_COMPLIANCE_DOCUMENT_BYTES = 20 * 1024 * 1024;

export function validateComplianceDocumentFile(file) {
  if (!file) return 'Select a PDF or image to upload.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected file is empty.';
  if (file.size > MAX_COMPLIANCE_DOCUMENT_BYTES) return 'The selected file must be 20 MB or smaller.';

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType !== 'application/pdf' && !mimeType.startsWith('image/')) {
    return 'Upload a PDF or image file.';
  }
  return '';
}
