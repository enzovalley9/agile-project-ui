import { describe, expect, it } from 'vitest';
import { indexProject } from '../../../../packages/domain/src/index';
import { documentTreeDocuments } from './document-tree';

describe('document tree scope', () => {
  it('shows conventional documentation and configured roots without surrounding project files', () => {
    const files = {
      '_bmad/config.toml': '[core]\noutput_folder="planning"\nproject_knowledge="knowledge"',
      '_bmad-output/brief.md': '# Brief',
      'docs/guide.md': '# Guide',
      'doc/api.md': '# API',
      'documentation/setup.md': '# Setup',
      'packages/app/docs/usage.md': '# Usage',
      'planning/plan.md': '# Plan',
      'knowledge/context.md': '# Context',
      'extra/design.md': '# Design',
      'README.md': '# Repository',
      'package.json': '{}',
      'src/data.json': '{}',
      'scripts/settings.yaml': 'enabled: true',
      'docs-old/old.md': '# Old',
      'planning-other/other.md': '# Other',
    };
    const index = indexProject(files, {}, { additionalRoots: ['extra'] });
    expect(
      documentTreeDocuments(index, 'project')
        .map((doc) => doc.path)
        .sort(),
    ).toEqual(
      [
        '_bmad-output/brief.md',
        'doc/api.md',
        'docs/guide.md',
        'documentation/setup.md',
        'extra/design.md',
        'knowledge/context.md',
        'packages/app/docs/usage.md',
        'planning/plan.md',
      ].sort(),
    );
    expect(index.documents.some((doc) => doc.path === 'package.json')).toBe(true);
  });

  it.each(['_bmad-output', 'docs', 'doc', 'documentation', 'Docs'])(
    'keeps direct selection of %s usable',
    (folder) => {
      const index = indexProject({ 'guide.md': '# Guide', 'notes/meeting.md': '# Meeting' });
      expect(documentTreeDocuments(index, folder)).toHaveLength(2);
    },
  );

  it('does not fall back to arbitrary root files when documentation is absent', () => {
    const index = indexProject({ 'README.md': '# Repository', 'package.json': '{}' });
    expect(documentTreeDocuments(index, 'project')).toEqual([]);
  });

  it('honors an explicitly configured project-root scope but hides installation metadata', () => {
    const index = indexProject({
      '_bmad/config.toml': '[core]\noutput_folder="{project-root}"',
      'brief.md': '# Brief',
      '_bmad/bmm/config.yaml': '<<<<<<< ours\nvalue: a\n=======\nvalue: b\n>>>>>>> theirs',
    });
    expect(documentTreeDocuments(index, 'project').map((doc) => doc.path)).toEqual(['brief.md']);
  });
});
