export type Provider = 'jira' | 'confluence';
export type Deployment = 'cloud' | 'data-center';
export type ManagedField = 'title' | 'description' | 'body' | 'status';
export type Direction = 'publish' | 'import';
export interface AdapterCapabilities {
  provider: Provider;
  deployment: Deployment;
  profile: string;
  read: boolean;
  search: boolean;
  compare: boolean;
  import: boolean;
  export: boolean;
  remoteUpdate: boolean;
  fields: ManagedField[];
  representations: string[];
  concurrency: 'none' | 'versioned-with-draft-risk' | 'atomic-test';
  blockedReasons: string[];
  liveVerified: false;
}
export interface CanonicalNode { type: string; text?: string; attrs?: Record<string, string | number | boolean>; marks?: {type: string; href?: string}[]; content?: CanonicalNode[] }
export interface ContentProjection { normalizerVersion: 1; nodes: CanonicalNode[]; complete: boolean; unsupported: string[]; markdown: string }
export interface RemoteResource {
  provider: Provider;
  deployment: Deployment;
  instance: string;
  id: string;
  key?: string;
  url: string;
  scopeId: string;
  scopeName?: string;
  title: string;
  version: string;
  observedAt: string;
  fields: Partial<Record<ManagedField,string>>;
  content: ContentProjection;
  representation: 'adf' | 'storage' | 'wiki' | 'plain';
  statusId?: string;
  transitions?: {id:string;name:string;toStatusId:string;toStatusName:string;requiredFields:string[]}[];
  draft: 'absent' | 'present' | 'unknown';
  provenance: {api:string;profile:string};
}
export interface LocalResource { path: string; revision: string; text: string; title?: string; status?: string; entityId?: string }
export interface ComparisonBase {
  schemaVersion: 1;
  normalizerVersion: 1;
  provider: Provider;
  instance: string;
  resourceId: string;
  local: Partial<Record<ManagedField,string>>;
  remote: Partial<Record<ManagedField,string>>;
  observedAt: string;
}
export type ComparisonState = 'equal' | 'no-base' | 'local-changes' | 'remote-changes' | 'both-changed' | 'convergent' | 'partial';
export interface ComparisonRow {field:ManagedField;local:string;remote:string;baseLocal?:string;baseRemote?:string;state:ComparisonState;comparable:boolean}
export interface Comparison {state:ComparisonState;rows:ComparisonRow[];coverage:{complete:boolean;unsupported:string[]};observedAt:string;normalizerVersion:1}
export interface PlanRequest {resourceId:string;scopeId?:string;local:LocalResource;base?:ComparisonBase;direction:Direction;fields:ManagedField[];transitionId?:string}
export interface IntegrationPlan {
  id:string;provider:Provider;resource:RemoteResource;local:LocalResource;direction:Direction;fields:ManagedField[];
  comparison:Comparison;blockedReasons:string[];transportLoss:string[];reviewedPayloadHash:string;createdAt:string;expiresAt:string;
  candidate:{text?:string;title?:string;status?:string;payload?:unknown};transitionId?:string;
}
export interface IntegrationOperation {
  id:string;planId:string;provider:Provider;instance:string;resourceId:string;direction:Direction;
  status:'prepared'|'running'|'verified'|'rejected'|'partial'|'uncertain';message:string;createdAt:string;updatedAt:string;
  expectedVersion:string;expectedFields:Partial<Record<ManagedField,string>>;reviewedPayloadHash:string;
  observed?:{version:string;observedAt:string;fields:Partial<Record<ManagedField,string>>};
}
export interface Scope {id:string;name:string;key?:string}
export interface ResourceSummary {id:string;key?:string;title:string;url:string;scopeId:string;version?:string}
export interface Page<T> {items:T[];complete:boolean;nextCursor?:string;warnings:string[]}
export interface HistoryEntry {id:string;version?:string;createdAt?:string;author?:string;summary:string}
export interface IntegrationBinding {
  schemaVersion:1;id:string;projectId:string;provider:Provider;deployment:Deployment;instance:string;resourceId:string;
  resourceKey?:string;resourceUrl:string;scopeId:string;
  local:{path:string;entityId?:string;kind?:string;section?:{heading:string;revision:string}};
  fields:ManagedField[];policy:'review-both-directions'|'publish-only'|'import-only';
  feature?:{instance:string;issueId:string;key?:string};normalizerVersion:1;
}
