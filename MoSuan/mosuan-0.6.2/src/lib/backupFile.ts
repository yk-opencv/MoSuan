import { newId } from './id';
import { isAndroidApp, NativeFiles } from './mobile';
import { downloadLocalFile } from './storage';

export async function saveBackupFile(blob: Blob) {
  const filename = `墨算备份-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mosuan.json`;
  if (!isAndroidApp()) {
    downloadLocalFile(filename, blob);
    return true;
  }
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const cacheName = newId() + '.tmp';
  const options = { path: 'mosuan-backups/' + cacheName, directory: Directory.Cache, encoding: Encoding.UTF8 };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    // Keep bridge messages bounded. The decoder carries any split UTF-8 character
    // into the next part, so Chinese and emoji are written byte for byte.
    const chunkSize = 512 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const end = Math.min(blob.size, offset + chunkSize);
      const buffer = await blob.slice(offset, end).arrayBuffer();
      const data = decoder.decode(buffer, { stream: end < blob.size });
      if (offset === 0) await Filesystem.writeFile({ ...options, data, recursive: true });
      else await Filesystem.appendFile({ ...options, data });
    }
    return !(await NativeFiles.saveBackup({ filename, cacheName })).cancelled;
  } finally {
    await Filesystem.deleteFile(options).catch(() => {});
  }
}
