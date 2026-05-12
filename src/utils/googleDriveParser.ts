/**
 * Utility to parse and convert Google Drive URLs to direct download links
 */

// Regex patterns for different Google Drive URL formats
const DRIVE_PATTERNS = [
  // Format: https://drive.google.com/file/d/{fileId}/view?usp=drive_link
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\//,
  // Format: https://drive.google.com/file/d/{fileId}/view
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/,
  // Format: https://drive.google.com/open?id={fileId}
  /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
  // Format: https://drive.google.com/uc?id={fileId}
  /drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/,
  // Format: https://drive.google.com/drive/folders/{fileId} (we'll handle folders separately)
  /drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/,
];

/**
 * Extract file ID from a Google Drive URL
 */
export function extractDriveFileId(url: string): string | null {
  for (const pattern of DRIVE_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if a URL is a Google Drive link
 */
export function isGoogleDriveUrl(url: string): boolean {
  return url.includes("drive.google.com");
}

/**
 * Convert Google Drive URL to direct download link
 * This creates a URL that can be downloaded directly
 */
export function convertToDirectDownloadUrl(driveUrl: string): string | null {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) return null;

  // Use the direct download format
  // Note: This requires the file to be publicly accessible
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Convert Google Drive URL to a thumbnail/preview URL
 * Good for images - creates a direct image link
 */
export function convertToDirectImageUrl(driveUrl: string): string | null {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) return null;

  // For images, use the thumbnail API which gives direct image access
  // This bypasses the viewer and gives direct image URL
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
}

/**
 * Parse multiple URLs (comma-separated) and convert Google Drive links
 */
export function parseAndConvertUrls(
  urlString: string,
  conversionType: "download" | "image" = "image",
): string[] {
  if (!urlString || !urlString.trim()) return [];

  const urls = urlString
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  return urls.map((url) => {
    if (isGoogleDriveUrl(url)) {
      const converted =
        conversionType === "image"
          ? convertToDirectImageUrl(url)
          : convertToDirectDownloadUrl(url);
      return converted || url; // Fallback to original if conversion fails
    }
    return url;
  });
}
