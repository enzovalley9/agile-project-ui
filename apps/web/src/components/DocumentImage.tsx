import {useEffect,useState} from 'react';
import {ImageOff} from 'lucide-react';
import type {ProjectStore} from '../services/project-store';
import {resolveDocumentLink} from './DocumentReader';
import styles from '../App.module.css';

export function DocumentImage({src,alt,documentPath,store,resourceVersion}:{src?:string;alt?:string;documentPath:string;store?:ProjectStore;resourceVersion?:object}){
 const [url,setUrl]=useState<string|null>(null),[error,setError]=useState('');
 const remote=!!src&&/^https?:\/\//i.test(src);
 const path=src&&!remote?resolveDocumentLink(documentPath,src):null;
 useEffect(()=>{let cancelled=false,created:string|undefined;setUrl(null);setError('');if(!remote&&path&&store)void store.readImage(path).then(blob=>{if(cancelled)return;created=URL.createObjectURL(blob);setUrl(created);}).catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:String(error));});return()=>{cancelled=true;if(created)URL.revokeObjectURL(created);};},[path,remote,store,resourceVersion]);
 if(url&&!error)return <span className={styles.localImageFrame}><img className={styles.localImage} src={url} alt={alt??''} title={path??undefined} onError={()=>setError('No se pudo decodificar la imagen local. Se conserva el archivo original.')}/></span>;
 return <span className={styles.imagePlaceholder}><ImageOff size={16}/>{alt||'Imagen del documento'}<small>{remote?'Imagen remota bloqueada; no se carga al abrir el documento.':error||(!path?'Ruta de imagen no compatible o fuera del proyecto.':!store?'Vista previa local no disponible.':'Leyendo imagen local…')}</small>{remote&&src&&<a href={src} target="_blank" rel="noopener noreferrer">Abrir imagen externa explícitamente</a>}{path&&<small>{path}</small>}</span>;
}
