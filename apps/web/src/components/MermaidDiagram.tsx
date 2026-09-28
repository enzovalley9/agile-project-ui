import { useEffect, useId, useRef, useState } from 'react';
import styles from '../App.module.css';

// Mermaid has global configuration: serialize initialization and rendering across documents.
let rendering = Promise.resolve();
export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const target = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Rendering diagram…');
  useEffect(() => {
    let disposed = false;
    const render = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      rendering = rendering
        .catch(() => undefined)
        .then(async () => {
          if (disposed) return;
          setStatus('Rendering diagram…');
          try {
            if (source.length > 50_000) throw new Error('Diagram too large');
            const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
              import('mermaid'),
              import('dompurify'),
            ]);
            if (disposed) return;
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: 'strict',
              suppressErrorRendering: true,
              maxTextSize: 50_000,
              maxEdges: 500,
              theme: dark ? 'dark' : 'default',
              htmlLabels: false,
              secure: [
                'secure',
                'securityLevel',
                'startOnLoad',
                'maxTextSize',
                'maxEdges',
                'suppressErrorRendering',
                'dompurifyConfig',
                'htmlLabels',
              ],
            });
            const { svg } = await mermaid.render(`diagram-${id}`, source);
            if (disposed || !target.current) return;
            const clean = DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
              FORBID_TAGS: ['foreignObject', 'image', 'a'],
              FORBID_ATTR: ['href', 'xlink:href'],
            });
            target.current.innerHTML = clean;
            setStatus('');
          } catch {
            if (!disposed) {
              target.current?.replaceChildren();
              setStatus('Diagram preview unavailable. The Mermaid source is preserved below.');
            }
          }
        });
    };
    render();
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [source, id]);
  return (
    <figure className={styles.mermaid} aria-label="Mermaid diagram">
      {status && <p role="status">{status}</p>}
      <div ref={target} role="img" aria-label="Rendered Mermaid diagram" />
      <details>
        <summary>Mermaid source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
