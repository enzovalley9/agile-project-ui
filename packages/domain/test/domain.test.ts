import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  indexProject,
  visibleWorkItems,
  planWorkItemEdit,
  mergeConfiguration,
  parseCsv,
  resolveDocumentLink,
  type FileSnapshot,
} from '../src/index';

const P = '_bmad-output/planning-artifacts',
  I = '_bmad-output/implementation-artifacts',
  S = '_bmad-output/specs/spec-bookings';
const manifest = 'installation:\n  version: 6.12.0\nmodules:\n  - name: bmm\n    version: 6.12.0\n';
const toml =
  '[core]\nproject_name = "Neighborhood bookings"\noutput_folder = "{project-root}/_bmad-output"\n[modules.bmm]\nplanning_artifacts = "{output_folder}/planning-artifacts"\nimplementation_artifacts = "{output_folder}/implementation-artifacts"\nproject_knowledge = "{project-root}/docs"\n';
const epics =
  '# Booking plan\n\n## Epic 1: Book a court\n\nAllow booking a neighborhood court.\n\n### Story 1.1: Choose a time\n\nAs a neighbor,\nI want to choose a time,\nSo that I can make a booking.\n\n#### Acceptance Criteria\n\nGiven an available court\nWhen I select a time\nThen the booking appears.\n';
const legacy =
  '# Story 1.1: Choose a time\n\nStatus: ready-for-dev\n\n## Story\n\nAs a neighbor, I want to choose a time.\n\n## Acceptance Criteria\n\nThe time slot is available.\n\n## Tasks / Subtasks\n\n- [ ] Show time slots\n  - [x] Read the calendar\n\n## Dev Notes\n\nPreserve this text.\n';
const sprint =
  'generated: 09-27-2026 09:00\nlast_updated: 09-27-2026 09:00\nproject: Bookings\nproject_key: R\ntracking_system: file-system\nstory_location: "{project-root}/_bmad-output/implementation-artifacts"\n# keep this comment\ndevelopment_status:\n  epic-1: in-progress\n  1-1-choose-time: ready-for-dev # keep this too\n  1-2-pay-booking: backlog\n  epic-1-retrospective: optional\ncustom_extension: untouched\n';
const build =
  '---\ntitle: "Local notifications"\ntype: feature\ncreated: 2026-09-27\nstatus: in-review\nroute: standard\nunknown: { keep: true }\n---\n# Local notifications\n\n## Intent\n\nNotify the neighbor upon confirmation.\n\n## Tasks & Acceptance\n\n- [ ] Prepare the notification\n\n## Implementation Notes\n\nUnrelated text.\n';
function base(extra: Record<string, string> = {}): Record<string, string> {
  return {
    '_bmad/_config/manifest.yaml': manifest,
    '_bmad/config.toml': toml,
    '_bmad/bmm/config.yaml':
      'project_name: Neighborhood bookings\noutput_folder: "{project-root}/_bmad-output"\nplanning_artifacts: "{output_folder}/planning-artifacts"\nimplementation_artifacts: "{output_folder}/implementation-artifacts"\nproject_knowledge: "{project-root}/docs"\n',
    [`${P}/epics.md`]: epics,
    [`${I}/sprint-status.yaml`]: sprint,
    [`${I}/1-1-choose-time.md`]: legacy,
    'docs/README.md': '# Knowledge\n\nOriginal synthetic project.\n',
    ...extra,
  };
}
function revisions(files: FileSnapshot) {
  return Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path,
      createHash('sha256').update(text).digest('hex'),
    ]),
  );
}
function inspect(files: FileSnapshot) {
  return indexProject(files, revisions(files));
}
const codes = (files: FileSnapshot) => inspect(files).diagnostics.map((d) => d.code);

describe('BMAD 6.12 artifact fixture contract BC-01–20', () => {
  it('BC-01 indexes immutable hybrid defaults with provenance and no filesystem effects', () => {
    const files = Object.freeze(base()),
      before = JSON.stringify(files),
      result = inspect(files);
    expect(result.name).toBe('Neighborhood bookings');
    expect(result.declaredVersion).toBe('6.12.0');
    expect(result.compatibility).toBe('6.12.0');
    expect(result.roots.find((root) => root.role === 'planning')?.path).toBe(P);
    expect(result.diagnostics.some((d) => d.code === 'configuration-divergent')).toBe(false);
    const item = result.workItems.find(
      (item) => item.family === 'sprint' && item.nativeId === '1.1',
    )!;
    expect(item.title).toBe('Choose a time');
    expect(item.status?.raw).toBe('ready-for-dev');
    expect(item.source.path).toBe(`${I}/sprint-status.yaml`);
    expect(item.source.revision).toHaveLength(64);
    expect(visibleWorkItems(result).filter((item) => item.nativeId === '1.1')).toHaveLength(1);
    expect(JSON.stringify(files)).toBe(before);
  });
  it('BC-02 resolves nonstandard output and knowledge and additional document roots', () => {
    const result = inspect({
      '_bmad/config.toml': toml
        .replaceAll('_bmad-output', 'artifacts')
        .replaceAll('/docs', '/knowledge'),
      'artifacts/planning-artifacts/prd.md': '# PRD',
      'knowledge/adr.md': '# ADR',
      'documentation/runbook.md': '# Runbook',
    });
    expect(result.roots.find((root) => root.role === 'output')?.path).toBe('artifacts');
    expect(result.roots.find((root) => root.role === 'knowledge')?.path).toBe('knowledge');
    expect(result.documents).toHaveLength(3);
    const extra = indexProject(
      { 'manual/guide.md': '# Guide' },
      {},
      { additionalRoots: ['manual', '../private'] },
    );
    expect(extra.roots.some((r) => r.path === 'manual')).toBe(true);
    expect(extra.diagnostics.some((d) => d.code === 'unsafe-root')).toBe(true);
  });
  it('BC-03 honors four TOML layers and exposes YAML divergence without changing files', () => {
    const files = base({
      '_bmad/config.user.toml': '[core]\noutput_folder="{project-root}/team"\n',
      '_bmad/custom/config.toml': '[core]\noutput_folder="{project-root}/custom"\n',
      '_bmad/custom/config.user.toml': '[core]\noutput_folder="{project-root}/mine"\n',
      'mine/planning-artifacts/prd.md': '# Mine',
    });
    const result = inspect(files);
    expect(result.roots.filter((r) => r.role === 'output').map((r) => r.path)).toEqual([
      'mine',
      '_bmad-output',
    ]);
    expect(result.diagnostics.some((d) => d.code === 'configuration-divergent')).toBe(true);
    expect(
      mergeConfiguration(
        { entries: [{ code: 'a', value: 1 }], arr: ['a'] },
        {
          entries: [
            { code: 'a', value: 2 },
            { id: 'b', value: 3 },
          ],
          arr: ['b'],
        },
      ),
    ).toEqual({
      entries: [
        { code: 'a', value: 2 },
        { id: 'b', value: 3 },
      ],
      arr: ['a', 'b'],
    });
  });
  it('BC-04 degrades unknown/incomplete installation and absent sprint honestly', () => {
    const result = inspect({
      'docs/prd.md': '# Project',
      '_bmad/_config/manifest.yaml': 'installation: [',
    });
    expect(result.documents).toHaveLength(1);
    expect(result.compatibility).toBe('unknown');
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['version-unknown', 'sprint-absent', 'invalid-yaml']),
    );
  });
  it('BC-05 preserves multiple PRD workspaces, addenda and memlog separately', () => {
    const files = base({
      [`${P}/prds/a/prd.md`]: '---\ntitle: First\nstatus: draft\n---\n# PRD A',
      [`${P}/prds/a/addendum.md`]: '# Detail',
      [`${P}/prds/a/.memlog.md`]: '# Memlog',
      [`${P}/prds/b/prd.md`]: '# PRD B',
    });
    const result = inspect(files);
    expect(result.documents.filter((d) => d.kind === 'prd')).toHaveLength(2);
    expect(result.documents.find((d) => d.title === 'First')?.derived).toBe(true);
    expect(result.documents.some((d) => d.path.endsWith('addendum.md'))).toBe(true);
  });
  it('BC-06 exposes inherited architecture and manual ADR without inventing standalone decisions', () => {
    const result = inspect(
      base({
        [`${P}/architecture/run/ARCHITECTURE-SPINE.md`]:
          '---\ntype: architecture-spine\nbinds: [AD-1]\n---\n# Architecture\n\n## AD-1: Local data\n\nInherited decision.',
        'docs/adrs/ADR-001.md': '# Manual decision',
      }),
    );
    expect(
      result.documents.filter((d) => d.kind === 'architecture' || d.kind === 'adr'),
    ).toHaveLength(2);
    expect(result.workItems.some((item) => item.nativeId === 'AD-1')).toBe(false);
  });
  it('BC-07 differentiates complete and partial UX contracts', () => {
    const files = base({ [`${P}/ux/run/DESIGN.md`]: '# Design' });
    expect(codes(files)).toContain('ux-partial');
    files[`${P}/ux/run/EXPERIENCE.md`] = '# Interaction';
    expect(codes(files)).not.toContain('ux-partial');
  });
  it('BC-08 keeps whole and sharded documents without alphabetical reassembly', () => {
    const result = inspect({
      'docs/prd.md': '# Whole',
      'docs/prd/index.md': '# Index\n\n[Second](b.md)\n[First](a.md)',
      'docs/prd/a.md': '# First',
      'docs/prd/b.md': '# Second',
    });
    expect(result.documents).toHaveLength(4);
    expect(result.diagnostics.some((d) => d.code === 'document-representations-ambiguous')).toBe(
      true,
    );
    expect(
      result.documents.find((d) => d.path === 'docs/prd/index.md')?.links.map((l) => l.target),
    ).toEqual(['docs/prd/b.md', 'docs/prd/a.md']);
  });
  it('BC-09 recognizes split IDs and Unicode but not fenced or translated examples', () => {
    // The escaped Spanish heading must stay unrecognized by the English BMAD grammar.
    const result = inspect({
      'docs/epics.md':
        '# Work\n\n## Epic 2: Prepare a résumé\n\n### Story 2.6a: Add an emoji 🧩\n\n## \u0048\u0069\u0073\u0074\u006f\u0072\u0069\u0061 2.7: Not structural\n\n```md\n### Story 2.8: Example\n```',
    });
    expect(result.workItems.map((i) => i.nativeId)).toEqual(['2', '2.6a']);
    expect(result.workItems[1].title).toBe('Add an emoji 🧩');
    expect(
      inspect({ 'docs/examples.md': '```md\n# Story 1.1: Example\n```' }).workItems,
    ).toHaveLength(0);
  });
  it('BC-10 preserves all sprint vocabularies plus legacy and unknown statuses', () => {
    const result = inspect({
      'sprint-status.yaml':
        'development_status:\n  epic-1: backlog\n  1-1-a: drafted\n  1-2-b: contexted\n  1-3-c: alien\n  epic-1-retrospective: optional\naction_items:\n  - description: Review accessibility\n    status: open\n',
    });
    expect(result.workItems.find((i) => i.nativeId === '1.1')?.status).toMatchObject({
      raw: 'drafted',
      normalized: 'ready-for-dev',
      valid: true,
    });
    expect(result.workItems.find((i) => i.nativeId === '1.3')?.status).toMatchObject({
      raw: 'alien',
      valid: false,
    });
    expect(result.workItems.find((i) => i.kind === 'action')?.status?.allowed).toEqual([
      'open',
      'in-progress',
      'done',
    ]);
    expect(result.workItems.find((i) => i.kind === 'retrospective')?.status?.allowed).toEqual([
      'optional',
      'done',
    ]);
  });
  it('BC-11 isolates invalid YAML and preserves sprint comments/extensions during edits', () => {
    const files = base({ 'docs/broken.yaml': 'a: [', 'docs/ok.md': '# Okay' }),
      result = inspect(files);
    expect(result.documents.find((d) => d.path === 'docs/broken.yaml')?.capabilities.textEdit).toBe(
      true,
    );
    const item = result.workItems.find((i) => i.family === 'sprint' && i.nativeId === '1.2')!;
    const plan = planWorkItemEdit(result, files, {
      id: item.id,
      field: 'status',
      value: 'ready-for-dev',
    });
    expect(plan.changes[0].after).toBe(
      sprint.replace('1-2-pay-booking: backlog', '1-2-pay-booking: ready-for-dev'),
    );
    expect(plan.changes[0].after).toContain('# keep this comment');
    expect(plan.changes[0].after).toContain('custom_extension: untouched');
  });
  it('BC-12 blocks unsafe title migration rather than changing sprint identity', () => {
    const files = base(),
      result = inspect(files),
      item = result.workItems.find((i) => i.family === 'legacy-story')!;
    expect(item.editable.title).toBe(false);
    expect(() =>
      planWorkItemEdit(result, files, { id: item.id, field: 'title', value: 'Another title' }),
    ).toThrow(/sprint key/);
    expect(files[`${I}/sprint-status.yaml`]).toBe(sprint);
  });
  it('BC-13 parses body status and nested checklists, without completing parent', () => {
    const files = base(),
      result = inspect(files),
      item = result.workItems.find((i) => i.family === 'legacy-story')!;
    expect(item.status?.raw).toBe('ready-for-dev');
    expect(item.checklist.map((c) => c.checked)).toEqual([false, true]);
    expect(item.checklist[1].depth).toBe(1);
    const plan = planWorkItemEdit(result, files, {
      id: item.id,
      field: 'checklist',
      checklistId: item.checklist[0].id,
      value: true,
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].after).toBe(legacy.replace('- [ ] Show', '- [x] Show'));
    expect(plan.changes[0].after).toContain('Status: ready-for-dev');
  });
  it('BC-14 accepts Build and oneshot without fabricating missing tasks', () => {
    const result = inspect({
      [`${I}/spec-notices.md`]: build,
      [`${I}/spec-quick.md`]:
        '---\ntitle: Quick\ntype: chore\nstatus: done\nroute: oneshot\n---\n# Quick\n\n## Intent\n\nChange a label.\n',
    });
    expect(result.workItems.filter((i) => i.kind === 'build')).toHaveLength(2);
    expect(result.workItems.find((i) => i.title === 'Quick')?.checklist).toHaveLength(0);
  });
  it('BC-15 keeps Build done versus sprint review and Build Auto blocked', () => {
    const files = base({
      [`${I}/sprint-status.yaml`]: sprint.replace(
        '1-1-choose-time: ready-for-dev',
        '1-1-choose-time: review',
      ),
      [`${I}/spec-1-1-choose-time.md`]: build.replace('status: in-review', 'status: done'),
      [`${I}/spec-auto.md`]: build.replace('status: in-review', 'status: blocked'),
    });
    delete files[`${I}/1-1-choose-time.md`];
    const result = inspect(files),
      item = result.workItems.find((i) => i.family === 'build' && i.nativeId === '1.1')!;
    expect(item.status?.raw).toBe('done');
    expect(item.relatedStatuses[0].raw).toBe('review');
    expect(result.diagnostics.some((d) => d.code === 'status-discrepancy')).toBe(false);
    expect(result.workItems.find((i) => i.family === 'build-auto')?.status?.valid).toBe(true);
  });
  it('BC-16 generated SPEC stays text editable/commentable with warning and unchanged memlog', () => {
    const files = base({
        [`${S}/SPEC.md`]:
          '---\nid: bookings\ncompanions: [COMPANION.md]\nsources: [../../planning-artifacts/epics.md]\n---\n# SPEC\n',
        [`${S}/.memlog.md`]: '# Source decisions',
      }),
      copy = JSON.stringify(files),
      result = inspect(files),
      doc = result.documents.find((d) => d.kind === 'spec')!;
    expect(doc.derived).toBe(true);
    expect(doc.capabilities.textEdit).toBe(true);
    expect(doc.capabilities.comment).toBe(true);
    expect(doc.warnings[0]).toContain('regenerate');
    expect(JSON.stringify(files)).toBe(copy);
  });
  it('BC-17 ordered SPEC stories have no status and association ambiguity stays visible', () => {
    const stories =
      '- id: "3"\n  title: Third\n  description: Third scope\n- id: "3-2"\n  title: Second\n  description: Second scope\n';
    const result = inspect({
      [`${S}/stories.yaml`]: stories,
      [`${S}/stories/3-one.md`]: build,
      [`${S}/stories/3-two.md`]: build,
    });
    expect(
      result.workItems.filter((i) => i.family === 'spec-story').map((i) => i.nativeId),
    ).toEqual(['3', '3-2']);
    expect(
      result.workItems
        .filter((i) => i.family === 'spec-story')
        .every((i) => i.status === undefined && i.editable.status === false),
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'stories-id-ambiguous')).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'execution-ambiguous')).toBe(true);
    expect(
      codes({
        [`${S}/stories.yaml`]: '- id: "1"\n  title: Uno\n  description: Scope\n  status: done\n',
      }),
    ).toContain('stories-status-forbidden');
  });
  it('BC-18 standalone retrospective never invents sprint and compiled context warns of freshness', () => {
    const result = inspect({
      [`${S}/RETROSPECTIVE.md`]: '# Retrospective',
      [`${I}/epic-1-context.md`]: '# Compiled epic',
    });
    expect(result.documents.find((d) => d.kind === 'retrospective')).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === 'sprint-absent')).toBe(true);
    expect(result.workItems).toHaveLength(0);
    expect(result.documents.find((d) => d.kind === 'context')?.warnings[0]).toContain('outdated');
  });
  it('BC-19 rejects escaping/binary/oversize paths and treats active content as inert data', () => {
    const result = inspect({
      '../outside.md': 'secret',
      '.env': 'SECRET=x',
      'docs/nul.md': 'a\0b',
      'docs/huge.md': 'x'.repeat(2 * 1024 * 1024 + 1),
      'docs/active.md':
        '# Safe\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![tracker](https://tracker.invalid/pixel)\n\n[escape](../../private.md)',
    });
    expect(result.documents).toHaveLength(1);
    expect(result.coverage.partial).toBe(true);
    expect(result.documents[0].links.map((l) => l.kind)).toEqual([
      'blocked',
      'external',
      'blocked',
    ]);
    expect(result.documents[0].capabilities.textEdit).toBe(true);
  });
  it('BC-20 unknown ticketing/version provides honest generic reading', () => {
    const result = inspect({
      '_bmad/_config/manifest.yaml': manifest.replace('6.12.0', '9.0.0'),
      'tickets.toml': '[[entry]]\nid="a"\n',
    });
    expect(result.compatibility).toBe('unknown');
    expect(result.workItems).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['version-unsupported', 'ticketing-unsupported']),
    );
  });
});

describe('preserving structured editing', () => {
  it('preserves BOM, CRLF, quotes, unknown frontmatter and untouched code during Build title edit', () => {
    const path = `${I}/spec-notices.md`,
      text = '\uFEFF' + build.replaceAll('\n', '\r\n'),
      files = { [path]: text },
      result = inspect(files),
      item = result.workItems[0];
    const plan = planWorkItemEdit(result, files, {
      id: item.id,
      field: 'title',
      value: 'Neighborhood notices',
    });
    expect(plan.changes[0].after).toBe(
      text.replace('title: "Local notifications"', 'title: "Neighborhood notices"'),
    );
    expect(plan.changes[0].expectedRevision).toBe(revisions(files)[path]);
  });
  it('edits exact description section and status without changing unrelated content', () => {
    const path = `${I}/spec-notices.md`,
      files = { [path]: build },
      result = inspect(files),
      item = result.workItems[0];
    expect(
      planWorkItemEdit(result, files, {
        id: item.id,
        field: 'description',
        value: 'Show reminders without sending emails.',
      }).changes[0].after,
    ).toBe(
      build.replace(
        'Notify the neighbor upon confirmation.',
        'Show reminders without sending emails.',
      ),
    );
    expect(
      planWorkItemEdit(result, files, { id: item.id, field: 'status', value: 'done' }).changes[0]
        .after,
    ).toBe(build.replace('status: in-review', 'status: done'));
    expect(() =>
      planWorkItemEdit(result, files, { id: item.id, field: 'status', value: 'review' }),
    ).toThrow(/vocabulary/);
  });
  it('changes coupled legacy story/sprint together only when their base statuses agree', () => {
    const files = base(),
      result = inspect(files),
      item = result.workItems.find((i) => i.family === 'sprint' && i.nativeId === '1.1')!;
    const plan = planWorkItemEdit(result, files, {
      id: item.id,
      field: 'status',
      value: 'in-progress',
    });
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes.find((c) => c.path.endsWith('.yaml'))?.after).toBe(
      sprint.replace('1-1-choose-time: ready-for-dev', '1-1-choose-time: in-progress'),
    );
    expect(plan.changes.find((c) => c.path.endsWith('.md'))?.after).toBe(
      legacy.replace('Status: ready-for-dev', 'Status: in-progress'),
    );
    const divergent = base({
        [`${I}/1-1-choose-time.md`]: legacy.replace('ready-for-dev', 'done'),
      }),
      index = inspect(divergent);
    expect(index.diagnostics.some((d) => d.code === 'status-discrepancy')).toBe(true);
    expect(
      index.workItems.find((i) => i.family === 'sprint' && i.nativeId === '1.1')?.editable.status,
    ).toBe(false);
  });
  it('lets a sprint story edit its proven breakdown narrative while preserving identity and acceptance criteria', () => {
    const files = base(),
      result = inspect(files),
      item = result.workItems.find((i) => i.family === 'sprint' && i.nativeId === '1.1')!;
    expect(item.editable.description).toBe(true);
    const plan = planWorkItemEdit(result, files, {
      id: item.id,
      field: 'description',
      value: 'As a neighbor, I want to book without waiting.',
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].path).toBe(`${P}/epics.md`);
    expect(plan.changes[0].after).toBe(
      epics.replace(
        'As a neighbor,\nI want to choose a time,\nSo that I can make a booking.',
        'As a neighbor, I want to book without waiting.',
      ),
    );
    expect(plan.changes[0].after).toContain('### Story 1.1: Choose a time');
  });
  it('edits SPEC-story title and literal-block description without inventing status or altering IDs', () => {
    const path = `${S}/stories.yaml`,
      text =
        '- id: "first"\n  title: First\n  description: |\n    Original text.\n    Second line.\n  spec_checkpoint: true\n',
      files = { [path]: text },
      index = inspect(files),
      item = index.workItems[0];
    expect(
      planWorkItemEdit(index, files, { id: item.id, field: 'title', value: 'Updated' }).changes[0]
        .after,
    ).toBe(text.replace('title: First', 'title: Updated'));
    const plan = planWorkItemEdit(index, files, {
      id: item.id,
      field: 'description',
      value: 'New text\nAnother line',
    });
    expect(plan.changes[0].after).toContain('id: "first"');
    expect(plan.changes[0].after).toContain('spec_checkpoint: true');
    expect(inspect({ [path]: plan.changes[0].after }).workItems[0].description).toBe(
      'New text\nAnother line',
    );
    expect(plan.changes[0].after).not.toContain('status:');
  });
  it('recognizes CRLF legacy Status without changing line endings', () => {
    const path = 'docs/story.md',
      text = legacy.replaceAll('\n', '\r\n'),
      files = { [path]: text },
      index = inspect(files),
      item = index.workItems[0];
    expect(item.status?.raw).toBe('ready-for-dev');
    expect(
      planWorkItemEdit(index, files, { id: item.id, field: 'status', value: 'review' }).changes[0]
        .after,
    ).toBe(text.replace('Status: ready-for-dev', 'Status: review'));
  });
  it('guards changed field, invalid title, duplicate Status and YAML aliases', () => {
    const path = `${I}/spec-notices.md`,
      files = { [path]: build },
      index = inspect(files),
      item = index.workItems[0];
    expect(() =>
      planWorkItemEdit(
        index,
        { [path]: build.replace('Local notifications', 'New') },
        { id: item.id, field: 'title', value: 'Overwrite' },
      ),
    ).toThrow(/changed/);
    expect(() =>
      planWorkItemEdit(index, files, { id: item.id, field: 'title', value: 'two\nlines' }),
    ).toThrow(/single-line/);
    const duplicate = inspect({
      'story.md': legacy.replace('Status: ready-for-dev', 'Status: ready-for-dev\n\nStatus: done'),
    });
    expect(duplicate.workItems[0].editable.status).toBe(false);
    expect(codes({ 'sprint-status.yaml': 'development_status: &a\n  epic-1: *a\n' })).toContain(
      'sprint-status-invalid',
    );
  });
  it('maps hidden frontmatter and Unicode to actual source lines and keeps fenced tasks inert', () => {
    const source =
      '---\ntitle: Example\n---\n\n# Tree 🧩\n\n- [ ] Action 😀\n\n```md\n- [ ] Fake\n```\n';
    const index = inspect({ 'docs/unicode.md': source });
    expect(index.documents[0].headings[0].lineStart).toBe(5);
    expect(index.workItems).toHaveLength(1);
    expect(index.workItems[0].checklist[0].source.lineStart).toBe(7);
    expect(source.slice(index.workItems[0].source.start, index.workItems[0].source.end)).toBe(' ');
  });
});

describe('checklist provenance across planning and execution', () => {
  const planning = epics + '\n- [x] Agree acceptance\n- [ ] Review overlap\n';
  function withoutExecution(extra: FileSnapshot = {}) {
    const files = base({ [`${P}/epics.md`]: planning, ...extra });
    delete files[`${I}/1-1-choose-time.md`];
    return files;
  }
  function visibleStory(index: ReturnType<typeof inspect>) {
    return visibleWorkItems(index).find(
      (item) => item.kind === 'story' && item.nativeId === '1.1',
    )!;
  }
  it('retains a unique breakdown checklist in the sprint and edits only its original planning bytes', () => {
    const files = withoutExecution(),
      before = JSON.stringify(files),
      index = inspect(files),
      item = visibleStory(index),
      breakdown = index.workItems.find(
        (candidate) => candidate.family === 'epic-breakdown' && candidate.nativeId === '1.1',
      )!;
    expect(item.family).toBe('sprint');
    expect(item.checklist.map((task) => [task.text, task.checked])).toEqual([
      ['Agree acceptance', true],
      ['Review overlap', false],
    ]);
    expect(item.checklist).toEqual(breakdown.checklist);
    expect(item.documentPath).toBeUndefined();
    const task = item.checklist[1],
      plan = planWorkItemEdit(index, files, {
        id: item.id,
        field: 'checklist',
        checklistId: task.id,
        value: true,
      });
    expect(task.source.path).toBe(`${P}/epics.md`);
    expect(plan.changes).toEqual([
      {
        path: `${P}/epics.md`,
        before: planning,
        after: planning.replace('- [ ] Review overlap', '- [x] Review overlap'),
        expectedRevision: revisions(files)[`${P}/epics.md`],
      },
    ]);
    const after = { ...files, [plan.changes[0].path]: plan.changes[0].after };
    expect(after[`${I}/sprint-status.yaml`]).toBe(sprint);
    expect(visibleStory(inspect(after)).checklist.every((check) => check.checked)).toBe(true);
    expect(JSON.stringify(files)).toBe(before);
  });
  it.each(['separate documents', 'duplicate identity in one document'])(
    'does not select planning tasks from ambiguous breakdowns: %s',
    (variant) => {
      const files = withoutExecution(
        variant === 'separate documents'
          ? { [`${P}/alternative/epics.md`]: planning }
          : { [`${P}/epics.md`]: planning + '\n### Story 1.1: Alternative\n\n- [ ] Other task\n' },
      );
      const index = inspect(files),
        item = visibleStory(index);
      expect(
        index.diagnostics.some((diagnostic) => diagnostic.code === 'work-identity-ambiguous'),
      ).toBe(true);
      expect(item.checklist).toEqual([]);
      expect(() =>
        planWorkItemEdit(index, files, {
          id: item.id,
          field: 'checklist',
          checklistId: 'unproven-task',
          value: true,
        }),
      ).toThrow(/does not belong/);
    },
  );
  it('does not hide competing execution sources with a planning fallback', () => {
    const index = inspect(
      base({
        [`${P}/epics.md`]: planning,
        [`${I}/1-1-alternative.md`]: legacy.replace('Show time slots', 'Alternative execution'),
      }),
    );
    expect(index.diagnostics.some((diagnostic) => diagnostic.code === 'execution-ambiguous')).toBe(
      true,
    );
    expect(visibleStory(index).checklist).toEqual([]);
    expect(visibleStory(index).editable.status).toBe(false);
  });
  it.each([true, false])(
    'preserves an explicitly empty legacy execution checklist with sprint tracking %s',
    (tracked) => {
      const files = base({
        [`${P}/epics.md`]: planning,
        [`${I}/1-1-choose-time.md`]: legacy.replace(
          '- [ ] Show time slots\n  - [x] Read the calendar\n',
          '',
        ),
      });
      if (!tracked) delete files[`${I}/sprint-status.yaml`];
      const item = visibleStory(inspect(files));
      expect(item.family).toBe(tracked ? 'sprint' : 'legacy-story');
      expect(item.checklist).toEqual([]);
      expect(item.documentPath).toBe(`${I}/1-1-choose-time.md`);
    },
  );
});

describe('read-only installed catalog and safe discovery', () => {
  it('AGT-01 resolves real roster customization and quoted help CSV; no fixed agent list', () => {
    const files = base({
      '_bmad/config.toml':
        toml +
        '[agents.bmad-agent-dev]\nname="Amelia"\ntitle="Engineer"\nmodule="bmm"\ndescription="Implements work"\n',
      '_bmad/custom/config.user.toml': '[agents.bmad-agent-dev]\nname="Custom Amelia"\n',
      '_bmad/_config/bmad-help.csv':
        'module,phase,name,code,command,description,action,required,output-location\nbmm,ship,Build,build,bmad-build,"Build, review and test",,true,implementation\nbmm,ship,Sprint,sp,bmad-sprint-planning,Read sprint,status,false,implementation\nbmm,ship,Sprint,sp,bmad-sprint-planning,Plan sprint,create,false,implementation\n',
    });
    const index = inspect(files);
    expect(index.agents).toHaveLength(1);
    expect(index.agents[0]).toMatchObject({
      name: 'Custom Amelia',
      module: 'bmm',
      customized: true,
      status: 'declared',
    });
    expect(index.skills[0].description).toBe('Build, review and test');
    expect(new Set(index.skills.map((s) => s.id)).size).toBe(3);
    expect(index.agents[0]).not.toHaveProperty('runtime');
  });
  it('AGT-02–04 unknown config/output-only permission never creates default agents or execution', () => {
    expect(inspect({ '_bmad-output/prd.md': '# PRD' }).agents).toEqual([]);
    expect(inspect({ '_bmad/config.toml': '[agents' }).agents).toEqual([]);
    expect(
      inspect({ '_bmad/_config/bmad-help.csv': 'name,skill\n"unfinished' }).diagnostics.some(
        (d) => d.code === 'catalog-invalid',
      ),
    ).toBe(true);
  });
  it('rejects unknown variables, cycles and absolute output roots', () => {
    for (const output of ['{unknown}/out', '/private/data', '{planning_artifacts}']) {
      const index = inspect({
        '_bmad/config.toml': `[core]\noutput_folder="${output}"\n[modules.bmm]\nplanning_artifacts="{output_folder}/planning"\n`,
      });
      expect(index.diagnostics.some((d) => d.code === 'unresolved-root')).toBe(true);
      expect(index.roots.some((r) => r.role === 'output')).toBe(false);
    }
  });
  it('handles quoted CSV with embedded newline and rejects malformed rows', () => {
    expect(parseCsv('a,b\n"hello,\nworld","a""b"\n')).toEqual([
      ['a', 'b'],
      ['hello,\nworld', 'a"b'],
    ]);
    expect(() => parseCsv('a,b\n"bad')).toThrow();
  });
  it('resolves internal links and denies encoded escapes, data/file/JS and absolute references', () => {
    const files = { 'docs/a.md': '# A', 'docs/b.md': '# B' };
    expect(resolveDocumentLink('docs/a.md', 'b.md#heading', files)).toMatchObject({
      kind: 'local',
      target: 'docs/b.md',
      exists: true,
    });
    for (const url of [
      '../../private.md',
      '%2e%2e/%2e%2e/private.md',
      'javascript:alert(1)',
      'data:text/html,bad',
      'file:///tmp/a',
      '//tracker.invalid/a',
      '/etc/passwd',
    ])
      expect(resolveDocumentLink('docs/a.md', url, files).kind).toBe('blocked');
  });
});

describe('project documents with an optional shared BMAD installation', () => {
  const child = {
    '_bmad-output/planning-artifacts/prd.md': '# Project PRD',
    '_bmad-output/implementation-artifacts/sprint-status.yaml': sprint,
    'docs/README.md': '# Project knowledge',
  };
  const shared = {
    projectRelativePath: 'teams/bookings',
    files: {
      '_bmad/_config/manifest.yaml': manifest,
      '_bmad/config.toml':
        toml
          .replaceAll('{project-root}/_bmad-output', '{project-root}/teams/bookings/_bmad-output')
          .replaceAll('{project-root}/docs', '{project-root}/teams/bookings/docs') +
        '[agents.bmad-agent-dev]\nname="Amelia"\nmodule="bmm"\n',
      '_bmad/_config/bmad-help.csv': 'module,name,command\nbmm,Build,bmad-build\n',
    },
  };
  it('indexes an output-only child and reports absent installation without implying missing documents', () => {
    const result = indexProject(child, revisions(child));
    expect(result.documents.map((document) => document.path)).toHaveLength(3);
    expect(result.workItems.some((item) => item.family === 'sprint')).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'installation-absent',
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'version-unknown',
    );
    expect(result.roots.find((root) => root.role === 'output')).toMatchObject({
      path: '_bmad-output',
      exists: true,
    });
  });
  it('maps shared TOML and YAML roots into the child while indexing only child documents', () => {
    const result = indexProject(child, revisions(child), {
      sharedInstallation: {
        ...shared,
        files: {
          ...shared.files,
          '_bmad/bmm/config.yaml':
            'output_folder: "{project-root}/teams/bookings/_bmad-output"\nproject_knowledge: "{project-root}/teams/bookings/docs"\n',
          'teams/other/_bmad-output/private.md': '# Must not appear',
        },
      },
    });
    expect(result.declaredVersion).toBe('6.12.0');
    expect(result.roots.find((root) => root.role === 'output')).toMatchObject({
      path: '_bmad-output',
      exists: true,
    });
    expect(result.roots.find((root) => root.role === 'knowledge')).toMatchObject({
      path: 'docs',
      exists: true,
    });
    expect(result.agents).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
    expect(result.documents).toHaveLength(3);
    expect(result.coverage.filesProvided).toBe(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'installation-absent',
    );
  });
  it('rejects roots outside the selected child without scanning sibling content', () => {
    const result = indexProject(child, revisions(child), {
      sharedInstallation: {
        projectRelativePath: 'teams/bookings',
        files: {
          '_bmad/config.toml':
            '[core]\noutput_folder="{project-root}/teams/other/_bmad-output"\nproject_knowledge="{project-root}/teams/bookings/docs"\n',
          'teams/other/_bmad-output/secret.md': '# No',
        },
      },
    });
    expect(result.roots.some((root) => root.role === 'output')).toBe(false);
    expect(result.roots.find((root) => root.role === 'knowledge')?.path).toBe('docs');
    expect(result.documents).toHaveLength(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'shared-root-outside-project',
    );
  });
  it('resolves plain relative roots against the shared installation folder', () => {
    const result = indexProject(child, revisions(child), {
      sharedInstallation: {
        projectRelativePath: 'teams/bookings',
        files: {
          '_bmad/config.toml':
            '[core]\noutput_folder="teams/bookings/_bmad-output"\nproject_knowledge="teams/bookings/docs"\n',
        },
      },
    });
    expect(result.roots.find((root) => root.role === 'output')?.path).toBe('_bmad-output');
    expect(result.roots.find((root) => root.role === 'knowledge')?.path).toBe('docs');
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'shared-root-outside-project',
    );
  });
  it('does not trust an escaping project path or convert shared metadata into documents', () => {
    const result = indexProject(child, revisions(child), {
      sharedInstallation: {
        projectRelativePath: '../teams/bookings',
        files: shared.files,
      },
    });
    expect(result.declaredVersion).toBeUndefined();
    expect(result.documents).toHaveLength(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'shared-project-path-invalid',
    );
  });
});
