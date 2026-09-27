import {describe,it,expect} from 'vitest';
import {indeterminateAtlassianApply} from './AtlassianPanel';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {StoryDescription} from './WorkViews';

describe('Atlassian operation evidence',()=>{
 it('allows re-comparison after an explicitly rejected pre-effect request',()=>{for(const code of ['plan_expired','blocked_plan','remote_stale','session_expired','journal_locked','invalid_content_type','invalid_plan','reconciliation_required'])expect(indeterminateAtlassianApply(Object.assign(new Error('Rejected'),{code}))).toBe(false);});
 it('requires reconciliation after transport loss or unexplained internal failure',()=>{expect(indeterminateAtlassianApply(new TypeError('Connection lost'))).toBe(true);expect(indeterminateAtlassianApply({code:'internal_error'})).toBe(true);});
});
describe('story description rendering',()=>{
 it('renders formatting and safe links without executing embedded source',()=>{const html=renderToStaticMarkup(createElement(StoryDescription,{text:'**Acceptance**\n\n- First\n- Second\n\n<script>alert(1)</script>\n\n![remote](https://example.test/tracker.png)\n\n[Unsafe](javascript:alert(1))',path:'docs/epics.md',onNavigate:()=>{}}));expect(html).toContain('<strong>Acceptance</strong>');expect(html).toContain('<ul>');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).not.toContain('href="javascript:');});
});
