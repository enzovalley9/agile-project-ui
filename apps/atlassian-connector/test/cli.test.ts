import { describe, expect, it } from 'vitest';
import { parseArguments } from '../src/cli';

describe('Atlassian connector container arguments', () => {
  it('keeps native loopback binding unless explicitly overridden', () => {
    expect(parseArguments([])['listen-host']).toBe('127.0.0.1');
    expect(parseArguments(['--listen-host', '0.0.0.0'])['listen-host']).toBe('0.0.0.0');
  });
  it.each(['::', 'localhost', '192.0.2.1', '*', '0.0.0.0; echo unsafe'])(
    'rejects unsupported listen host %s',
    (value) => {
      expect(() => parseArguments(['--listen-host', value])).toThrow(/Listen host/);
    },
  );
  it('rejects arbitrary commands', () => {
    expect(() => parseArguments(['--command', 'whoami'])).toThrow();
  });
});
