import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { sourceLineSeparator, serializedSourceSelection } from './SourceEditor';
describe('source editor exact serialization', () => {
  it('preserves BOM and CRLF after a normal edit', () => {
    const source = '\uFEFF# Heading\r\n\r\nBody text.\r\n';
    const state = EditorState.create({
      doc: source,
      extensions: [EditorState.lineSeparator.of(sourceLineSeparator(source))],
    });
    const from = state.doc.toString().indexOf('Body');
    const next = state.update({ changes: { from, to: from + 4, insert: 'Updated body' } }).state;
    expect(next.sliceDoc()).toBe('\uFEFF# Heading\r\n\r\nUpdated body text.\r\n');
  });
  it('maps CodeMirror LF offsets back to exact CRLF source offsets', () => {
    const source = 'one\r\ntwo\r\nthree';
    const state = EditorState.create({
      doc: source,
      extensions: [EditorState.lineSeparator.of(sourceLineSeparator(source))],
      selection: EditorSelection.single(4, 7),
    });
    expect(serializedSourceSelection(state)).toEqual({ start: 5, end: 8, quote: 'two' });
  });
  it('retains LF-only documents', () => {
    const source = 'one\ntwo';
    const state = EditorState.create({
      doc: source,
      extensions: [EditorState.lineSeparator.of(sourceLineSeparator(source))],
    });
    expect(state.sliceDoc()).toBe(source);
  });
});
