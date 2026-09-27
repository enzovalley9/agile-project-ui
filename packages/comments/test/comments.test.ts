import { describe, it, expect } from 'vitest';
import {
  createThread,
  makeAnchor,
  makeFragmentAnchor,
  resolveAnchor,
  updateThread,
  parseThread,
  serializeThread,
  formatMessageDate,
} from '../src/index';
const me = { id: 'local-a', name: 'Ana' },
  other = { id: 'local-b', name: 'Ana' };
const source = '---\ntitle: Huerto\n---\n# Riego\n\nLucía 💧 conserva su turno.\n';
describe('persistent comments', () => {
  it('anchors physical source lines including frontmatter and Unicode', () => {
    const anchor = makeAnchor('docs/a.md', source, 'r1', 6);
    expect(anchor.quote).toBe('Lucía 💧 conserva su turno.');
    expect(resolveAnchor(anchor, source, 'r1')).toEqual({
      state: 'exact',
      startLine: 6,
      endLine: 6,
    });
    expect(resolveAnchor(anchor, 'Nueva línea\n' + source, 'r2')).toEqual({
      state: 'moved',
      startLine: 7,
      endLine: 7,
    });
  });
  it('keeps ambiguous and removed anchors detached', () => {
    const a = makeAnchor('a.md', 'duplicado', 'r1', 1);
    expect(resolveAnchor(a, 'duplicado\notro\nduplicado', 'r2').state).toBe('ambiguous');
    expect(resolveAnchor(a, 'texto cambiado', 'r2').state).toBe('outdated');
    expect(resolveAnchor(a, undefined).state).toBe('missing');
  });
  it('maps exact fragments using source offsets without splitting Unicode', () => {
    const start = source.indexOf('Lucía'),
      end = source.indexOf(' conserva');
    const a = makeFragmentAnchor('a.md', source, 'r1', start, end);
    expect(a.quote).toBe('Lucía 💧');
    expect(resolveAnchor(a, source, 'r1').state).toBe('exact');
    expect(resolveAnchor(a, 'Header\n' + source, 'r2').startLine).toBe(7);
  });
  it('roundtrips one thread and preserves own-message edit history', () => {
    const thread = createThread(
      makeAnchor('a.md', source, 'r1', 6),
      me,
      'Una respuesta',
      '2026-09-27T10:00:00Z',
    );
    const edited = updateThread(
      thread,
      me,
      { type: 'edit', messageId: thread.messages[0].id, text: 'Corregida' },
      '2026-09-27T10:01:00Z',
    );
    expect(edited.messages[0].revisions?.[0].text).toBe('Una respuesta');
    expect(edited.messages[0].createdAt).toBe(thread.messages[0].createdAt);
    expect(parseThread(serializeThread(edited))).toEqual(edited);
    expect(() =>
      updateThread(thread, other, {
        type: 'edit',
        messageId: thread.messages[0].id,
        text: 'Suplantada',
      }),
    ).toThrow('your own');
  });
  it('toggles per-message reactions preserving other actors and separate approvals', () => {
    let thread = createThread(makeAnchor('a.md', source, 'r1', 6), me, 'Revisar');
    const id = thread.messages[0].id;
    thread = updateThread(thread, me, { type: 'react', messageId: id, kind: 'like' });
    thread = updateThread(thread, other, { type: 'react', messageId: id, kind: 'like' });
    thread = updateThread(thread, me, { type: 'react', messageId: id, kind: 'dislike' });
    thread = updateThread(thread, me, { type: 'react', messageId: id, kind: 'approve' });
    expect(thread.messages[0].reactions).toEqual([
      { actorId: other.id, actorName: other.name, kind: 'like' },
      { actorId: me.id, actorName: me.name, kind: 'dislike' },
      { actorId: me.id, actorName: me.name, kind: 'approve' },
    ]);
    thread = updateThread(thread, me, { type: 'react', messageId: id, kind: 'dislike' });
    expect(thread.messages[0].reactions).toHaveLength(2);
  });
  it('resolves/reopens without losing messages and records reanchor history', () => {
    const a = makeAnchor('a.md', source, 'r1', 6);
    let t = createThread(a, me, 'Revisar');
    t = updateThread(t, me, { type: 'reply', text: 'Revisado' });
    t = updateThread(t, me, { type: 'resolve' });
    t = updateThread(t, me, { type: 'reopen' });
    t = updateThread(t, me, { type: 'reanchor', anchor: { ...a, path: 'b.md' } });
    expect(t.messages).toHaveLength(2);
    expect(t.status).toBe('open');
    expect(t.events?.map((e) => e.type)).toEqual(['resolved', 'reopened', 'reanchored']);
    expect(t.events?.[2].previousAnchor?.path).toBe('a.md');
  });
  it('rejects invalid or future schema without mutation', () => {
    expect(() => parseThread('{"schemaVersion":99}')).toThrow();
    expect(() => createThread(makeAnchor('a.md', source, 'r1', 6), me, ' ')).toThrow();
  });
  it('uses Madrid calendar days across DST rather than elapsed 24 hours', () => {
    expect(formatMessageDate('2026-03-28T22:30:00Z', new Date('2026-03-29T22:15:00Z'))).toContain(
      'The day before yesterday',
    );
    expect(formatMessageDate('2026-09-26T22:05:00Z', new Date('2026-09-27T08:00:00Z'))).toBe(
      'Today, 00:05',
    );
    expect(formatMessageDate('2026-09-25T22:05:00Z', new Date('2026-09-27T08:00:00Z'))).toBe(
      'Yesterday, 00:05',
    );
  });
});
