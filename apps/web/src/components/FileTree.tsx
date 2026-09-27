import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, FileText, Search, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import styles from '../App.module.css';

interface Node { name: string; path: string; children: Map<string, Node>; file: boolean }
export function FileTree({ paths, selected, onSelect }: { paths: string[]; selected: string; onSelect: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => { const ancestors=selected.split('/').slice(0,-1).map((_,i,a)=>a.slice(0,i+1).join('/')); setClosed(old=>{const next=new Set(old);ancestors.forEach(path=>next.delete(path));return next;}); },[selected]);
  const tree = useMemo(() => {
    const root: Node = { name: '', path: '', children: new Map(), file: false };
    for (const path of paths.filter(p => p.toLowerCase().includes(query.toLowerCase()))) {
      let current = root; const parts = path.split('/');
      parts.forEach((part, i) => { const nextPath = parts.slice(0, i + 1).join('/'); let child = current.children.get(part); if (!child) { child = { name: part, path: nextPath, children: new Map(), file: i === parts.length - 1 }; current.children.set(part, child); } current = child; });
    }
    return root;
  }, [paths, query]);
  const toggle = (path: string, open: boolean) => setClosed(old => { const next = new Set(old); open ? next.delete(path) : next.add(path); return next; });
  function nodes(parent: Node) {
    return [...parent.children.values()].sort((a,b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name, 'es')).map(node => node.file ?
      <button key={node.path} className={styles.treeFile} aria-current={selected === node.path ? 'page' : undefined} title={node.path} onClick={() => onSelect(node.path)}><span /><FileText size={14} aria-hidden="true"/><span>{node.name}</span></button> :
      <details key={node.path} className={styles.treeFolder} open={!closed.has(node.path) || (query.length > 0)} onToggle={event => toggle(node.path, event.currentTarget.open)}>
        <summary title={node.path}><ChevronRight className={styles.chevron} size={14} aria-hidden="true"/><Folder size={14} aria-hidden="true"/><span>{node.name}</span></summary>
        <div className={styles.treeChildren}>{nodes(node)}</div>
      </details>);
  }
  return <aside className={styles.sidebar} aria-label="Explorador documental">
    <details className={styles.treeContainer} open><summary className={styles.treeHeading}>Documentos <span>{paths.length}</span></summary>
      <div className={styles.treeTools}><label className={styles.search}><Search size={14} aria-hidden="true"/><input aria-label="Buscar archivo" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar archivo…"/></label>
        <div className={styles.actions}><button className="iconButton" title="Expandir todo" aria-label="Expandir todo" onClick={() => setClosed(new Set())}><ChevronsUpDown size={15}/></button><button className="iconButton" title="Plegar todo" aria-label="Plegar todo" onClick={() => setClosed(new Set(paths.flatMap(p => p.split('/').slice(0,-1).map((_,i,a) => a.slice(0,i+1).join('/')))))}><ChevronsDownUp size={15}/></button></div>
      </div>
      <nav aria-label="Archivos del proyecto" className={styles.tree}>{nodes(tree)}{query && !tree.children.size && <p className={styles.muted}>No hay archivos con ese nombre.</p>}</nav>
    </details>
  </aside>;
}
