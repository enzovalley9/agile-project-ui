import {useEffect,useState} from 'react';
import type {ProjectStore,RecoveryStatus} from '../services/project-store';
import type {RecoveryCopy} from '../services/recovery-backups';
import {Dialog} from './Dialog';
import styles from '../App.module.css';

export function RecoveryDialog({store,status,onClose,onBusy,onRecovered}:{store:ProjectStore;status:RecoveryStatus;onClose:()=>void;onBusy:(value:boolean)=>void;onRecovered:()=>Promise<void>}){
 const [reviewed,setReviewed]=useState(status),[copies,setCopies]=useState<RecoveryCopy[]|null>(null),[actual,setActual]=useState<Record<string,string>>({}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[restore,setRestore]=useState<'before'|'after'|null>(null);
 const editable=store.mode==='edit';
 async function reload(){setLoading(true);setError('');try{const current=await store.recoveryStatus();if(!current){await onRecovered();return;}setReviewed(current);setCopies(await store.recoveryCopies());setActual(Object.fromEntries(await Promise.all(current.entries.map(async entry=>[entry.path,await store.read(entry.path).catch(()=>'Archivo no disponible para lectura.')] as const))));}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setLoading(false);}}
 useEffect(()=>{void reload();},[store]);
 async function apply(version?:'before'|'after'){setBusy(true);onBusy(true);setError('');try{if(version)await store.restoreRecovery(reviewed,version);else await store.reconcileRecovery(reviewed);await onRecovered();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);onBusy(false);setRestore(null);}}
 function exportCopies(){const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,recovery:reviewed,copies,current:actual},null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`bmad-recuperacion-${reviewed.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <Dialog title="Revisar guardado interrumpido" wide={!!copies} onClose={()=>{if(!busy)onClose();}}>
  <p>Compara los archivos actuales con el contenido original y el guardado previsto. Tus borradores siguen en esta pestaña.</p>
  {error&&<p role="alert" className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
  {loading&&<p role="status">Leyendo copias y archivos actuales…</p>}
  {reviewed.corrupt?<p role="alert">El registro no es legible. Conserva una copia y revisa externamente .bmad-project-ui/local/write-recovery.json antes de retirarlo.</p>:<>
   {!loading&&!copies&&<p role="alert">Este navegador no dispone de copias verificables. El registro conserva las rutas y huellas, pero no permite reconstruir el contenido. Revisa los archivos externamente antes de aceptar su estado.</p>}
   {!loading&&copies&&!reviewed.backupsPersistent&&<p role="alert">Las copias solo están en la memoria de esta pestaña. Descárgalas antes de cerrar o recargar.</p>}
   {copies&&reviewed.backupsPersistent&&<p className={styles.muted}>Copias verificadas en el almacenamiento privado de este navegador, fuera del repositorio.</p>}
   {reviewed.entries.map(entry=>{const copy=copies?.find(copy=>copy.path===entry.path);return <section key={entry.path} className={styles.comparisonField}><h3>{entry.path}</h3><p>{entry.state==='saved'?'Contenido previsto guardado':entry.state==='original'?'Contenido original conservado':'Contenido distinto; requiere revisión'}</p>{copy?<details><summary>Comparar original, archivo actual y contenido previsto</summary><div className={styles.threeWay}><section><h4>Original</h4><pre>{copy.before??'El archivo no existía.'}</pre></section><section><h4>Archivo actual</h4><pre>{actual[entry.path]??'Leyendo…'}</pre></section><section><h4>Contenido previsto</h4><pre>{copy.after}</pre></section></div></details>:<details><summary>Ver huellas del registro</summary><p className={styles.filePath}>Original: {entry.before??'archivo nuevo'}<br/>Actual: {entry.actual??'no disponible'}<br/>Previsto: {entry.after}</p></details>}</section>;})}
  </>}
  {!editable&&<p>Activa Editor para restaurar o aceptar el estado observado.</p>}
  <div className={styles.actions}><button disabled={busy||loading} onClick={()=>void reload()}>Volver a comprobar</button>{copies&&<button disabled={busy||loading} onClick={exportCopies}>Exportar copias</button>}</div>
  <div className={styles.dialogFooter}>
   {copies&&!reviewed.corrupt&&<><button disabled={!editable||busy||loading||copies.some(copy=>copy.before===null)} onClick={()=>setRestore('before')}>Restaurar originales</button><button className="primary" disabled={!editable||busy||loading} onClick={()=>setRestore('after')}>Completar guardado previsto</button></>}
   <button disabled={!editable||busy||loading||reviewed.corrupt} onClick={()=>void apply()}>Aceptar el estado comprobado</button>
  </div>
  {copies?.some(copy=>copy.before===null)&&<p className={styles.muted}>El plan incluye archivos nuevos. Para retirarlos, exporta las copias y revísalos externamente.</p>}
  <p className={styles.muted}>Aceptar el estado conserva los archivos tal como están y retira el registro de recuperación. Las nuevas escrituras se habilitarán después de volver a comprobar las huellas.</p>
  {restore&&<Dialog title={restore==='before'?'Restaurar originales':'Completar guardado previsto'} onClose={()=>{if(!busy)setRestore(null);}}><p>Se escribirán {reviewed.entries.length} archivos con {restore==='before'?'el contenido original':'el contenido previsto'} de las copias revisadas. Se volverá a comprobar que ningún archivo haya cambiado antes de guardar.</p><p>Los borradores de esta pestaña se conservan y pueden requerir una comparación posterior.</p><div className={styles.dialogFooter}><button disabled={busy} onClick={()=>setRestore(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={()=>void apply(restore)}>{busy?'Verificando…':'Confirmar restauración'}</button></div></Dialog>}
 </Dialog>;
}
