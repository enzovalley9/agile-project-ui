/** A disposable projection. Original project files remain the domain authority. */
export type FileSnapshot = Readonly<Record<string, string>>;
export type RevisionSnapshot = Readonly<Record<string, string>>;
export interface SourceRef {
  path: string;
  revision: string;
  locator: string;
  line?: number;
  lineStart: number;
  lineEnd: number;
  /** JavaScript UTF-16 offsets into the exact decoded source, never byte offsets. */
  start: number;
  end: number;
}
export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  path?: string;
  relatedPaths?: string[];
}
export interface DiscoveredRoot {
  path: string;
  role: 'output' | 'planning' | 'implementation' | 'knowledge' | 'additional';
  source: string;
  raw: string;
  exists: boolean;
}
export interface Heading extends SourceRef { level: number; title: string; anchor: string }
export interface DocumentLink {
  href: string;
  kind: 'local' | 'external' | 'anchor' | 'blocked';
  target?: string;
  exists?: boolean;
  line: number;
  image: boolean;
}
export type DocumentKind = 'markdown' | 'prd' | 'architecture' | 'adr' | 'ux' | 'spec' | 'epics' | 'story' | 'build' | 'sprint' | 'stories' | 'retrospective' | 'context' | 'yaml' | 'toml' | 'json' | 'text';
export interface DocumentRecord {
  path: string;
  title: string;
  kind: DocumentKind;
  revision: string;
  derived: boolean;
  capabilities: { read: boolean; comment: boolean; textEdit: boolean; structuredEdit: boolean };
  headings: Heading[];
  links: DocumentLink[];
  metadata: Record<string, unknown>;
  warnings: string[];
  parseValid: boolean;
  /** Includes frontmatter in source line numbering. */
  lineCount: number;
}
export type WorkItemKind = 'epic' | 'story' | 'build' | 'retrospective' | 'action' | 'checklist';
export interface StatusValue {
  raw: string;
  normalized?: string;
  valid: boolean;
  allowed: string[];
  source: SourceRef;
  /** Prevents conflating sprint tracking and execution status. */
  role: 'sprint' | 'execution' | 'document' | 'checklist' | 'action';
}
export interface FieldTarget {
  source: SourceRef;
  value: string;
  format: 'plain' | 'yaml-scalar' | 'markdown-section' | 'checkbox';
}
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  source: SourceRef;
  depth: number;
}
export interface WorkItem {
  id: string;
  nativeId?: string;
  kind: WorkItemKind;
  title: string;
  description?: string;
  epicId?: string;
  source: SourceRef;
  status?: StatusValue;
  relatedStatuses: StatusValue[];
  checklist: ChecklistItem[];
  editable: { title: boolean; description: boolean; status: boolean };
  fields: Partial<Record<'title' | 'description' | 'status', FieldTarget>>;
  warnings: string[];
  documentPath?: string;
  relatedPaths: string[];
  family: 'epic-breakdown' | 'legacy-story' | 'sprint' | 'build' | 'build-auto' | 'spec-story' | 'checklist' | 'retro-action';
}
export interface AgentRecord {
  id: string;
  code: string;
  name: string;
  title?: string;
  description?: string;
  module?: string;
  version?: string;
  source: string;
  customized: boolean;
  status: 'declared' | 'partial';
  actions: string[];
}
export interface SkillRecord {
  id: string;
  code: string;
  name: string;
  description?: string;
  module?: string;
  phase?: string;
  action?: string;
  required?: boolean;
  output?: string;
  source: string;
}
export interface ProjectIndex {
  name: string;
  declaredVersion?: string;
  compatibility: '6.12.0' | 'unknown';
  roots: DiscoveredRoot[];
  documents: DocumentRecord[];
  workItems: WorkItem[];
  agents: AgentRecord[];
  skills: SkillRecord[];
  diagnostics: Diagnostic[];
  coverage: { filesProvided: number; documents: number; excluded: number; partial: boolean; exclusions: string[] };
}
export interface IndexOptions { additionalRoots?: string[]; projectName?: string }
export interface FileChange { path: string; before: string; after: string; expectedRevision: string }
export interface WorkItemEdit {
  id: string;
  field: 'title' | 'description' | 'status' | 'checklist';
  value: string | boolean;
  checklistId?: string;
}
export interface EditPlan { changes: FileChange[]; warnings: string[] }
