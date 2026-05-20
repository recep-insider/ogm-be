'use strict';

const { errors, AppError } = require('../../src/shared/errors');

describe('errors factory', () => {
  it('varsayılan kodlar snake_case', () => {
    expect(errors.validation('x').code).toBe('validation_error');
    expect(errors.unauthorized().code).toBe('unauthorized');
    expect(errors.forbidden().code).toBe('forbidden');
    expect(errors.notFound().code).toBe('not_found');
    expect(errors.conflict('x').code).toBe('conflict');
    expect(errors.gone('x').code).toBe('gone');
    expect(errors.rateLimit().code).toBe('rate_limited');
    expect(errors.internal().code).toBe('internal_error');
  });

  it('kod override desteklenir', () => {
    expect(errors.conflict('x', undefined, 'already_applied').code).toBe('already_applied');
    expect(errors.notFound('x', 'mission_not_found').code).toBe('mission_not_found');
  });

  it('make() status+code+details taşır', () => {
    const e = errors.make(403, 'equipment_required', 'msg', { a: 1 });
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(403);
    expect(e.code).toBe('equipment_required');
    expect(e.details).toEqual({ a: 1 });
  });

  it('status kodları doğru', () => {
    expect(errors.validation('x').status).toBe(400);
    expect(errors.gone('x').status).toBe(410);
    expect(errors.rateLimit().status).toBe(429);
  });
});
