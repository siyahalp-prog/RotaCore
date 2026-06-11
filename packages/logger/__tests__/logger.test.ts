import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/index.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    name: 'test',
    level: 'debug',
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger };
}

describe('@rota-core/logger', () => {
  it('writes structured JSON logs', () => {
    const { lines, logger } = capture();
    logger.info('hello', { userId: 'u1' });
    expect(lines[0]).toMatchObject({ level: 'info', msg: 'hello', name: 'test', userId: 'u1' });
  });

  it('respects log level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'warn', write: (l) => lines.push(l) });
    logger.info('not logged');
    logger.warn('logged');
    expect(lines).toHaveLength(1);
  });

  it('redacts secrets', () => {
    const { lines, logger } = capture();
    logger.info('login', { password: 'hunter2', nested: { token: 'abc' }, safe: 'ok' });
    expect(lines[0]).toMatchObject({
      password: '[REDACTED]',
      nested: { token: '[REDACTED]' },
      safe: 'ok',
    });
  });

  it('supports child loggers with bindings', () => {
    const { lines, logger } = capture();
    logger.child({ requestId: 'r1' }).info('handled');
    expect(lines[0]).toMatchObject({ requestId: 'r1', msg: 'handled' });
  });
});
