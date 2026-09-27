import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../App.module.css';

export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId=useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!; dialog.showModal();
    const cancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab'||(event.target as Element).closest('dialog')!==dialog)return;const controls=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length>0&&element.closest('dialog')===dialog);const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();dialog.focus();return;}if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement as HTMLElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement as HTMLElement))){event.preventDefault();first.focus();}};
    dialog.addEventListener('cancel', cancel);dialog.addEventListener('keydown',trap);
    return () => { dialog.removeEventListener('cancel', cancel);dialog.removeEventListener('keydown',trap); dialog.close(); previous?.isConnected && previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.dialogWide : ''}`} aria-labelledby={titleId}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{title}</h2><button autoFocus type="button" className="iconButton" aria-label="Cerrar ventana" onClick={onClose}><X size={18} /></button></header>
    {children}
  </dialog>;
}
