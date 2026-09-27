import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { ProjectStore } from '../services/project-store';
import { resolveDocumentLink } from './DocumentReader';
import styles from '../App.module.css';

export function DocumentImage({
  src,
  alt,
  documentPath,
  store,
  resourceVersion,
}: {
  src?: string;
  alt?: string;
  documentPath: string;
  store?: ProjectStore;
  resourceVersion?: object;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState('');
  const remote = !!src && /^https?:\/\//i.test(src);
  const path = src && !remote ? resolveDocumentLink(documentPath, src) : null;
  useEffect(() => {
    let cancelled = false,
      created: string | undefined;
    setUrl(null);
    setError('');
    if (!remote && path && store)
      void store
        .readImage(path)
        .then((blob) => {
          if (cancelled) return;
          created = URL.createObjectURL(blob);
          setUrl(created);
        })
        .catch((error) => {
          if (!cancelled) setError(error instanceof Error ? error.message : String(error));
        });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, remote, store, resourceVersion]);
  if (url && !error)
    return (
      <span className={styles.localImageFrame}>
        <img
          className={styles.localImage}
          src={url}
          alt={alt ?? ''}
          title={path ?? undefined}
          onError={() =>
            setError('The local image could not be decoded. The original file is preserved.')
          }
        />
      </span>
    );
  return (
    <span className={styles.imagePlaceholder}>
      <ImageOff size={16} />
      {alt || 'Document image'}
      <small>
        {remote
          ? 'Remote image blocked; opening the document does not load it.'
          : error ||
            (!path
              ? 'Unsupported image path or path outside the project.'
              : !store
                ? 'Local preview unavailable.'
                : 'Reading local image…')}
      </small>
      {remote && src && (
        <a href={src} target="_blank" rel="noopener noreferrer">
          Open external image
        </a>
      )}
      {path && <small>{path}</small>}
    </span>
  );
}
