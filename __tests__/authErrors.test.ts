import { AuthFlowError, classifyAuthFailure, toAuthFlowError } from '../src/auth/authErrors';

it('classifies only the rejections the HTTP status identifies without ambiguity', () => {
  expect(classifyAuthFailure('sign_in', 401)).toBe('invalid_credentials');
  expect(classifyAuthFailure('verify', 400)).toBe('invalid_code');
  expect(classifyAuthFailure('verify', 401)).toBe('invalid_code');
  expect(classifyAuthFailure('sign_up', 409)).toBe('email_in_use');
  expect(classifyAuthFailure('resend', 429)).toBe('rate_limited');
  expect(classifyAuthFailure('sign_in', 0)).toBe('network');
  expect(classifyAuthFailure('sign_in', undefined)).toBe('network');
  expect(classifyAuthFailure('sign_up', 401)).toBe('unknown');
  expect(classifyAuthFailure('sign_in', 403)).toBe('unknown');
  expect(classifyAuthFailure('verify', 500)).toBe('unknown');
  expect(classifyAuthFailure('reset_code', 400)).toBe('invalid_code');
  expect(classifyAuthFailure('reset_password', 400)).toBe('unknown');
  expect(classifyAuthFailure('reset_request', 429)).toBe('rate_limited');
});

it('keeps the server message next to the kind', () => {
  const error = toAuthFlowError('sign_in', { message: 'Invalid credentials', statusCode: 401, error: 'AUTH_UNAUTHORIZED' });
  expect(error).toBeInstanceOf(AuthFlowError);
  expect([error.kind, error.serverMessage]).toEqual(['invalid_credentials', 'Invalid credentials']);
  expect(toAuthFlowError('sign_up', new Error('boom')).kind).toBe('network');
});
