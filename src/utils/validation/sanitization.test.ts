import {
  escapeHtml,
  normalizeTag,
  redactCommandArgs,
  redactSensitiveValue,
  redactUrl,
  sanitizeErrorMessage,
  sanitizeHeaders,
  sanitizeServerName,
  sanitizeServerNameForContext,
  sanitizeServerNameForDisplay,
  sanitizeUrlParam,
  validateAndSanitizeTag,
  validateAndSanitizeTags,
} from '@src/utils/validation/sanitization.js';

import { describe, expect, it } from 'vitest';

describe('escapeHtml', () => {
  it('should escape HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escapeHtml('Hello & "World"')).toBe('Hello &amp; &quot;World&quot;');
    expect(escapeHtml("It's a 'test'")).toBe('It&#039;s a &#039;test&#039;');
  });

  it('should handle empty strings', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null as any)).toBe('');
    expect(escapeHtml(undefined as any)).toBe('');
  });

  it('should handle normal text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
    expect(escapeHtml('12345')).toBe('12345');
  });
});

describe('sanitizeServerName', () => {
  it('should sanitize server names for filenames', () => {
    expect(sanitizeServerName('my-server')).toBe('my-server');
    expect(sanitizeServerName('my_server')).toBe('my_server');
    expect(sanitizeServerName('my.server')).toBe('my_server');
    expect(sanitizeServerName('my/server')).toBe('my_server');
    expect(sanitizeServerName('my\\server')).toBe('my_server');
  });

  it('should handle consecutive underscores', () => {
    expect(sanitizeServerName('my___server')).toBe('my_server');
    expect(sanitizeServerName('___my-server___')).toBe('my-server');
  });

  it('should handle empty or invalid names', () => {
    expect(sanitizeServerName('')).toBe('default');
    expect(sanitizeServerName('___')).toBe('default');
    expect(sanitizeServerName(null as any)).toBe('default');
    expect(sanitizeServerName(undefined as any)).toBe('default');
  });

  it('should limit length', () => {
    const longName = 'a'.repeat(200);
    expect(sanitizeServerName(longName)).toBe('a'.repeat(100));
  });
});

describe('sanitizeServerNameForDisplay', () => {
  it('should preserve more characters for display', () => {
    expect(sanitizeServerNameForDisplay('my-server.com')).toBe('my-server.com');
    expect(sanitizeServerNameForDisplay('my server (test)')).toBe('my server (test)');
  });

  it('should still escape dangerous characters', () => {
    expect(sanitizeServerNameForDisplay('my<script>server')).toBe('my_script_server');
    expect(sanitizeServerNameForDisplay('my"server')).toBe('my_server');
  });

  it('should have longer length limit', () => {
    const longName = 'a'.repeat(300);
    expect(sanitizeServerNameForDisplay(longName)).toBe('a'.repeat(200));
  });
});

describe('sanitizeUrlParam', () => {
  it('should URL encode parameters', () => {
    expect(sanitizeUrlParam('hello world')).toBe('hello%20world');
    expect(sanitizeUrlParam('hello+world')).toBe('hello%2Bworld');
    expect(sanitizeUrlParam('hello&world')).toBe('hello%26world');
  });

  it('should handle empty strings', () => {
    expect(sanitizeUrlParam('')).toBe('');
    expect(sanitizeUrlParam(null as any)).toBe('');
    expect(sanitizeUrlParam(undefined as any)).toBe('');
  });

  it('should limit length', () => {
    const longParam = 'a'.repeat(600);
    expect(sanitizeUrlParam(longParam).length).toBeLessThanOrEqual(500);
  });
});

describe('sanitizeErrorMessage', () => {
  it('should redact sensitive information', () => {
    expect(sanitizeErrorMessage('Error: password: secret123')).toBe('Error: password: [REDACTED]');
    expect(sanitizeErrorMessage('Token: abc123 failed')).toBe('Token: [REDACTED] failed');
    expect(sanitizeErrorMessage('Invalid key: xyz789')).toBe('Invalid key: [REDACTED]');
    expect(sanitizeErrorMessage('Auth=bearer token123')).toBe('auth=[REDACTED] token123');
  });

  it('should escape HTML in error messages', () => {
    expect(sanitizeErrorMessage('Error: <script>alert("xss")</script>')).toBe(
      'Error: &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('should handle case insensitive redaction', () => {
    expect(sanitizeErrorMessage('PASSWORD: secret123')).toBe('PASSWORD: [REDACTED]');
    expect(sanitizeErrorMessage('Secret: abc123')).toBe('Secret: [REDACTED]');
  });

  it('should limit length', () => {
    const longError = 'Error: ' + 'a'.repeat(2000);
    expect(sanitizeErrorMessage(longError).length).toBeLessThanOrEqual(1000);
  });
});

describe('sanitizeServerNameForContext', () => {
  const testName = 'my-server.test';

  it('should apply filename sanitization', () => {
    expect(sanitizeServerNameForContext(testName, 'filename')).toBe('my-server_test');
  });

  it('should apply display sanitization', () => {
    expect(sanitizeServerNameForContext(testName, 'display')).toBe('my-server.test');
  });

  it('should apply URL sanitization', () => {
    expect(sanitizeServerNameForContext(testName, 'url')).toBe('my-server.test');
  });

  it('should apply HTML sanitization', () => {
    const htmlName = 'my-server<script>';
    expect(sanitizeServerNameForContext(htmlName, 'html')).toBe('my-server_script');
  });

  it('should default to filename sanitization', () => {
    expect(sanitizeServerNameForContext(testName, 'unknown' as any)).toBe('my-server_test');
  });
});

describe('sanitizeHeaders', () => {
  it('should redact sensitive headers', () => {
    const headers = {
      authorization: 'Bearer token123',
      'x-auth-token': 'abc123',
      'x-api-key': 'key123',
      cookie: 'session=value',
      'set-cookie': 'session=value; Path=/',
      'content-type': 'application/json',
      'user-agent': 'test-agent',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized.authorization).toBe('[REDACTED]');
    expect(sanitized['x-auth-token']).toBe('[REDACTED]');
    expect(sanitized['x-api-key']).toBe('[REDACTED]');
    expect(sanitized.cookie).toBe('[REDACTED]');
    expect(sanitized['set-cookie']).toBe('[REDACTED]');
    expect(sanitized['content-type']).toBe('application/json');
    expect(sanitized['user-agent']).toBe('test-agent');
  });

  it('should handle case insensitive header names', () => {
    const headers = {
      Authorization: 'Bearer token123',
      'X-AUTH-TOKEN': 'abc123',
      COOKIE: 'session=value',
      'Content-Type': 'application/json',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized.Authorization).toBe('[REDACTED]');
    expect(sanitized['X-AUTH-TOKEN']).toBe('[REDACTED]');
    expect(sanitized.COOKIE).toBe('[REDACTED]');
    expect(sanitized['Content-Type']).toBe('application/json');
  });

  it('should handle auth header without prefix', () => {
    const headers = {
      auth: 'token123',
      'x-custom-auth': 'value123',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized.auth).toBe('[REDACTED]');
    expect(sanitized['x-custom-auth']).toBe('value123'); // Not in sensitive list
  });

  it('should handle empty or invalid headers', () => {
    expect(sanitizeHeaders({})).toEqual({});
    expect(sanitizeHeaders(null as any)).toEqual({});
    expect(sanitizeHeaders(undefined as any)).toEqual({});
    expect(sanitizeHeaders('not-object' as any)).toEqual({});
  });

  it('should preserve non-sensitive headers', () => {
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'test-agent',
      'x-request-id': '123',
      host: 'example.com',
      accept: 'application/json',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized).toEqual(headers);
  });
});

describe('validateAndSanitizeTag', () => {
  describe('valid tags', () => {
    it('should accept simple alphanumeric tags', () => {
      const result = validateAndSanitizeTag('web');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept tags with hyphens and underscores', () => {
      const result = validateAndSanitizeTag('web-api_v1');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web-api_v1');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should normalize case', () => {
      const result = validateAndSanitizeTag('WEB-API');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web-api');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should trim whitespace', () => {
      const result = validateAndSanitizeTag('  web-api  ');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web-api');
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('URL encoded tags', () => {
    it('should decode URL encoded tags', () => {
      const result = validateAndSanitizeTag('web%20api');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web api');
      expect(result.warnings).toContain('Tag was URL decoded');
    });

    it('should handle invalid URL encoding gracefully', () => {
      const result = validateAndSanitizeTag('web%ZZ');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Tag contains invalid URL encoding');
    });
  });

  describe('problematic characters', () => {
    it('should warn about commas', () => {
      const result = validateAndSanitizeTag('web,api');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('web,api');
      expect(result.warnings).toContain("Contains ',' - commas can interfere with tag list parsing");
    });

    it('should warn about ampersands', () => {
      const result = validateAndSanitizeTag('web&api');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Contains '&' - ampersands can interfere with URL parameters");
    });

    it('should warn about HTML injection characters', () => {
      const result = validateAndSanitizeTag('web<script>');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Contains '<' - less-than symbols can cause HTML injection issues");
      expect(result.warnings).toContain("Contains '>' - greater-than symbols can cause HTML injection issues");
    });

    it('should warn about quotes', () => {
      const result = validateAndSanitizeTag('web"api');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("Contains '\"' - double quotes can cause parsing issues");
    });

    it('should warn about control characters', () => {
      const result = validateAndSanitizeTag('web\napi');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Contains control characters that may cause issues');
    });

    it('should warn about non-ASCII characters', () => {
      const result = validateAndSanitizeTag('wëb-äpi');
      expect(result.isValid).toBe(true);
      expect(result.sanitizedTag).toBe('wëb-äpi');
      expect(result.warnings).toContain('Contains non-ASCII characters (international characters)');
    });
  });

  describe('invalid tags', () => {
    it('should reject empty strings', () => {
      const result = validateAndSanitizeTag('');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Tag cannot be empty or whitespace only');
    });

    it('should reject null/undefined', () => {
      const result1 = validateAndSanitizeTag(null as any);
      expect(result1.isValid).toBe(false);
      expect(result1.errors).toContain('Tag cannot be empty or null');

      const result2 = validateAndSanitizeTag(undefined as any);
      expect(result2.isValid).toBe(false);
      expect(result2.errors).toContain('Tag cannot be empty or null');
    });

    it('should reject whitespace-only strings', () => {
      const result = validateAndSanitizeTag('   ');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Tag cannot be empty or whitespace only');
    });

    it('should reject very long tags', () => {
      const longTag = 'a'.repeat(101);
      const result = validateAndSanitizeTag(longTag);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Tag length cannot exceed 100 characters');
    });
  });
});

describe('validateAndSanitizeTags', () => {
  describe('valid tag arrays', () => {
    it('should process array of valid tags', () => {
      const result = validateAndSanitizeTags(['web', 'API', '  mobile  ']);
      expect(result.validTags).toEqual(['web', 'api', 'mobile']);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.invalidTags).toHaveLength(0);
    });

    it('should remove duplicates after normalization', () => {
      const result = validateAndSanitizeTags(['web', 'WEB', '  Web  ']);
      expect(result.validTags).toEqual(['web']);
      expect(result.warnings).toContain('Duplicate tag after normalization: "WEB"');
      expect(result.warnings).toContain('Duplicate tag after normalization: "  Web  "');
    });

    it('should handle empty array', () => {
      const result = validateAndSanitizeTags([]);
      expect(result.validTags).toEqual([]);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('invalid inputs', () => {
    it('should reject non-arrays', () => {
      const result = validateAndSanitizeTags('not-array' as any);
      expect(result.validTags).toEqual([]);
      expect(result.errors).toContain('Tags must be an array');
    });

    it('should reject too many tags', () => {
      const manyTags = Array(51).fill('tag');
      const result = validateAndSanitizeTags(manyTags);
      expect(result.validTags).toEqual([]);
      expect(result.errors).toContain('Too many tags: maximum 50 allowed, got 51');
    });
  });

  describe('mixed valid and invalid tags', () => {
    it('should filter out invalid tags and keep valid ones', () => {
      const result = validateAndSanitizeTags(['web', '', 'api', null as any, 'mobile']);
      expect(result.validTags).toEqual(['web', 'api', 'mobile']);
      expect(result.invalidTags).toEqual(['', null]);
      expect(result.errors).toContain('Tag 2 "": Tag cannot be empty or whitespace only');
      expect(result.errors).toContain('Tag 4 "null": Tag cannot be empty or null');
    });

    it('should collect warnings for problematic characters', () => {
      const result = validateAndSanitizeTags(['web', 'api&test', 'mobile,responsive']);
      expect(result.validTags).toEqual(['web', 'api&test', 'mobile,responsive']);
      expect(result.warnings).toContain(
        'Tag "api&test": Contains \'&\' - ampersands can interfere with URL parameters',
      );
      expect(result.warnings).toContain(
        'Tag "mobile,responsive": Contains \',\' - commas can interfere with tag list parsing',
      );
    });
  });

  describe('custom max tags limit', () => {
    it('should respect custom max tags limit', () => {
      const result = validateAndSanitizeTags(['web', 'api', 'mobile'], 2);
      expect(result.validTags).toEqual([]);
      expect(result.errors).toContain('Too many tags: maximum 2 allowed, got 3');
    });
  });
});

describe('normalizeTag', () => {
  it('should normalize simple tags', () => {
    expect(normalizeTag('WEB')).toBe('web');
    expect(normalizeTag('  API  ')).toBe('api');
    expect(normalizeTag('Mobile-App')).toBe('mobile-app');
  });

  it('should handle URL encoded tags', () => {
    expect(normalizeTag('web%20api')).toBe('web api');
    expect(normalizeTag('mobile%2Dapp')).toBe('mobile-app');
  });

  it('should handle invalid URL encoding gracefully', () => {
    expect(normalizeTag('web%ZZ')).toBe('web%zz');
  });

  it('should handle empty/null inputs', () => {
    expect(normalizeTag('')).toBe('');
    expect(normalizeTag(null as any)).toBe('');
    expect(normalizeTag(undefined as any)).toBe('');
  });

  it('should preserve special characters after normalization', () => {
    expect(normalizeTag('Web&Api')).toBe('web&api');
    expect(normalizeTag('Mobile,Responsive')).toBe('mobile,responsive');
  });
});

describe('redactSensitiveValue', () => {
  it('should redact API keys with common prefixes', () => {
    expect(redactSensitiveValue('sk-1234567890abcdef')).toBe('[REDACTED]');
    expect(redactSensitiveValue('pk-abcdef1234567890')).toBe('[REDACTED]');
    expect(redactSensitiveValue('ak-xyz123456789012')).toBe('[REDACTED]');
    expect(redactSensitiveValue('rk-def456789012abc')).toBe('[REDACTED]');
  });

  it('should redact GitHub tokens', () => {
    expect(redactSensitiveValue('ghp_1234567890abcdef1234567890abcdef123456')).toBe('[REDACTED]');
    expect(redactSensitiveValue('gho_1234567890abcdef1234567890abcdef123456')).toBe('[REDACTED]');
  });

  it('should redact AWS access keys', () => {
    expect(redactSensitiveValue('AKIA1234567890ABCDEF')).toBe('[REDACTED]');
    expect(redactSensitiveValue('ASIA1234567890ABCDEF')).toBe('[REDACTED]');
  });

  it('should redact long tokens', () => {
    expect(redactSensitiveValue('a'.repeat(32))).toBe('[REDACTED]');
    expect(redactSensitiveValue('A1b2C3d4E5f6'.repeat(6))).toBe('[REDACTED]'); // 72 chars
  });

  it('should redact hex tokens', () => {
    expect(redactSensitiveValue('abcdef1234567890'.repeat(2))).toBe('[REDACTED]'); // 32 hex chars
  });

  it('should redact Bearer tokens', () => {
    expect(redactSensitiveValue('Bearer token123456789')).toBe('[REDACTED]');
    expect(redactSensitiveValue('bearer ABC123456789XYZ')).toBe('[REDACTED]');
  });

  it('should redact base64-like tokens', () => {
    expect(redactSensitiveValue('YWJjZGVmZ2hpams1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5')).toBe('[REDACTED]');
  });

  it('should NOT redact normal values', () => {
    expect(redactSensitiveValue('hello')).toBe('hello');
    expect(redactSensitiveValue('my-server')).toBe('my-server');
    expect(redactSensitiveValue('123')).toBe('123');
    expect(redactSensitiveValue('short')).toBe('short');
  });

  it('should handle empty or invalid input', () => {
    expect(redactSensitiveValue('')).toBe('');
    expect(redactSensitiveValue(null as any)).toBe(null);
    expect(redactSensitiveValue(undefined as any)).toBe(undefined);
  });
});

describe('redactCommandArgs', () => {
  it('should redact --key=value format for sensitive flags', () => {
    const args = ['--api-key=sk-1234567890abcdef', '--host=example.com'];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['--api-key=[REDACTED]', '--host=example.com']);
  });

  it('should redact --key value format for sensitive flags', () => {
    const args = ['--token', 'abc123456789', '--host', 'example.com'];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['--token', '[REDACTED]', '--host', 'example.com']);
  });

  it('should redact various sensitive flag names', () => {
    const args = [
      '--api-key=secret1',
      '--password=secret2',
      '--auth=secret3',
      '--credential=secret4',
      '--private-key=secret5',
    ];
    const result = redactCommandArgs(args);
    expect(result).toEqual([
      '--api-key=[REDACTED]',
      '--password=[REDACTED]',
      '--auth=[REDACTED]',
      '--credential=[REDACTED]',
      '--private-key=[REDACTED]',
    ]);
  });

  it('should redact based on value patterns even with non-sensitive flags', () => {
    const args = ['--config', 'sk-1234567890abcdef', '--debug'];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['--config', '[REDACTED]', '--debug']);
  });

  it('should handle mixed scenarios', () => {
    const args = [
      '--api-key=sk-secret123456',
      '--host',
      'example.com',
      '--token',
      'ghp_1234567890abcdef1234567890abcdef123456',
      '--verbose',
    ];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['--api-key=[REDACTED]', '--host', 'example.com', '--token', '[REDACTED]', '--verbose']);
  });

  it('should handle single-dash flags', () => {
    const args = ['-k', 'secret123', '-h', 'example.com'];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['-k', 'secret123', '-h', 'example.com']); // Single dash flags not detected as sensitive
  });

  it('should handle empty or invalid input', () => {
    expect(redactCommandArgs([])).toEqual([]);
    expect(redactCommandArgs(null as any)).toBe(null);
    expect(redactCommandArgs(undefined as any)).toBe(undefined);
  });

  it('should preserve non-sensitive arguments', () => {
    const args = ['--host', 'example.com', '--port', '8080', '--verbose'];
    const result = redactCommandArgs(args);
    expect(result).toEqual(['--host', 'example.com', '--port', '8080', '--verbose']);
  });
});

describe('redactUrl', () => {
  it('should redact basic authentication', () => {
    const url = 'https://user:password@api.example.com/v1';
    const result = redactUrl(url);
    expect(result).toBe('https://REDACTED:REDACTED@api.example.com/v1');
  });

  it('should redact sensitive query parameters', () => {
    const url = 'https://api.example.com/v1?api_key=secret123&token=abc456&data=safe';
    const result = redactUrl(url);
    expect(result).toBe('https://api.example.com/v1?api_key=REDACTED&token=REDACTED&data=safe');
  });

  it('should redact both auth and query parameters', () => {
    const url = 'https://user:pass@api.example.com/v1?token=secret&safe=value';
    const result = redactUrl(url);
    expect(result).toBe('https://REDACTED:REDACTED@api.example.com/v1?token=REDACTED&safe=value');
  });

  it('should handle various sensitive parameter names', () => {
    const url = 'https://api.com/v1?api-key=s1&access_token=s2&client_secret=s3&password=s4&auth=s5&normal=safe';
    const result = redactUrl(url);
    expect(result).toBe(
      'https://api.com/v1?api-key=REDACTED&access_token=REDACTED&client_secret=REDACTED&password=REDACTED&auth=REDACTED&normal=safe',
    );
  });

  it('should redact based on sensitive values in parameters', () => {
    const url = 'https://api.example.com/v1?config=sk-1234567890abcdef&data=normal';
    const result = redactUrl(url);
    expect(result).toBe('https://api.example.com/v1?config=REDACTED&data=normal');
  });

  it('should preserve non-sensitive URLs', () => {
    const url = 'https://api.example.com/v1?page=1&limit=10&sort=name';
    const result = redactUrl(url);
    expect(result).toBe('https://api.example.com/v1?page=1&limit=10&sort=name');
  });

  it('should handle malformed URLs with fallback patterns', () => {
    const url = 'not-a-url://user:password@host?api_key=secret';
    const result = redactUrl(url);
    expect(result).toBe('not-a-url://REDACTED:REDACTED@host?api_key=REDACTED');
  });

  it('should handle URLs without protocols', () => {
    const url = 'user:password@host.com/path?token=secret';
    const result = redactUrl(url);
    // This will fail URL parsing and fall back to regex
    expect(result).toBe('user:password@host.com/path?token=REDACTED');
  });

  it('should handle empty or invalid input', () => {
    expect(redactUrl('')).toBe('');
    expect(redactUrl(null as any)).toBe(null);
    expect(redactUrl(undefined as any)).toBe(undefined);
  });

  it('should handle URLs with only basic auth', () => {
    const url = 'https://apikey:secret@api.example.com/';
    const result = redactUrl(url);
    expect(result).toBe('https://REDACTED:REDACTED@api.example.com/');
  });

  it('should handle URLs with only query parameters', () => {
    const url = 'https://api.example.com/v1?secret=abc123&normal=value';
    const result = redactUrl(url);
    expect(result).toBe('https://api.example.com/v1?secret=REDACTED&normal=value');
  });
});
