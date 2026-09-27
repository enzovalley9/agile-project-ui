import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';

export function sourceLineSeparator(source:string):'\r\n'|'\n' { return source.includes('\r\n')?'\r\n':'\n'; }
export function serializedSourceSelection(state:EditorState):SourceSelection|null { const range=state.selection.main;return range.empty?null:{start:state.sliceDoc(0,range.from).length,end:state.sliceDoc(0,range.to).length,quote:state.sliceDoc(range.from,range.to)}; }
export interface SourceSelection { start: number; end: number; quote: string }
export function SourceEditor({ value, readOnly, onChange, onSelect, onSave }: { value: string; readOnly: boolean; onChange: (value:string)=>void; onSelect: (selection:SourceSelection)=>void; onSave:()=>void }) {
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange,onSelect,onSave }); callbacks.current = {onChange,onSelect,onSave};
  useEffect(() => {
    const view = new EditorView({ parent:host.current!, state: EditorState.create({ doc:value, extensions:[EditorState.lineSeparator.of(sourceLineSeparator(value)),lineNumbers(),highlightActiveLineGutter(),history(),markdown(),syntaxHighlighting(defaultHighlightStyle),EditorView.lineWrapping,EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),EditorView.contentAttributes.of({'aria-label':'Fuente Markdown',spellcheck:'false'}),keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave();return true;}},...defaultKeymap,...historyKeymap]),EditorView.updateListener.of(update=> {if(update.docChanged)callbacks.current.onChange(update.state.sliceDoc());if(update.selectionSet){const selection=serializedSourceSelection(update.state);if(selection)callbacks.current.onSelect(selection);}})] }) });
    editor.current=view; return()=>{view.destroy();editor.current=null;};
  },[readOnly,sourceLineSeparator(value)]);
  useEffect(()=> {const view=editor.current;if(view&&view.state.sliceDoc()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},[value]);
  return <div ref={host} className="sourceEditor"/>;
}
