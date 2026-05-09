// utils/imageUtils.ts

/**
 * Convert Google Drive URLs to direct downloadable image links
 * Supports:
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID
 */
export function convertDriveUrl(driveUrl: string): string {
  if (!driveUrl) return driveUrl;

  // Already a direct link or non-Google URL
  if (!driveUrl.includes("drive.google.com")) {
    return driveUrl;
  }

  // Extract file ID from various Google Drive URL formats
  let fileId = "";

  // Format: /file/d/FILE_ID/view
  const fileMatch = driveUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    fileId = fileMatch[1];
  }

  // Format: ?id=FILE_ID or &id=FILE_ID
  if (!fileId) {
    const idMatch = driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      fileId = idMatch[1];
    }
  }

  // Format: /uc?id=FILE_ID
  if (!fileId) {
    const ucMatch = driveUrl.match(/\/uc\?id=([a-zA-Z0-9_-]+)/);
    if (ucMatch) {
      fileId = ucMatch[1];
    }
  }

  if (!fileId) {
    console.warn(
      "⚠️ Could not extract file ID from Google Drive URL:",
      driveUrl,
    );
    return driveUrl;
  }

  // Return direct download link
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * Convert all image URLs in an array, handling Google Drive links
 */
export function convertAllDriveUrls(urls: string[]): string[] {
  return urls.map((url) => convertDriveUrl(url.trim()));
}
