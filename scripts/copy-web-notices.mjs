import { copyFile } from 'node:fs/promises';
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/web/THIRD_PARTY_NOTICES.md');
try {
  await copyFile('LICENSE', 'dist/web/LICENSE');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn(
    'First-party LICENSE is pending; this build is not ready for public redistribution.',
  );
}
