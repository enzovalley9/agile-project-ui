import type { ProjectIndex } from '../../../../packages/domain/src/index';

const documentationFolders = new Set(['_bmad-output', 'docs', 'doc', 'documentation']);

/** Navigation scope only: retain the project root for links, configuration and Git. */
export function documentTreeDocuments(index: ProjectIndex, selectedFolder: string) {
  const selectedDocumentation = documentationFolders.has(selectedFolder.toLowerCase());
  const roots = index.roots.map((root) => root.path.replace(/\/$/, ''));
  return index.documents.filter(({ path }) => {
    const parts = path.split('/');
    if (parts[0] === '_bmad' || parts[0] === '.bmad-project-ui') return false;
    return (
      selectedDocumentation ||
      parts.slice(0, -1).some((part) => documentationFolders.has(part.toLowerCase())) ||
      roots.some((root) => root === '' || root === '.' || path.startsWith(`${root}/`))
    );
  });
}
