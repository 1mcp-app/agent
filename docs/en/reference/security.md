---
title: Security Features - Tags-as-OAuth-Scopes Model
description: Learn about 1MCP security features including tags-as-OAuth-scopes model, scope validation, rate limiting, and audit logging.
head:
  - ['meta', { name: 'keywords', content: '1MCP security, OAuth 2.1, tags-as-scopes, security model, rate limiting' }]
  - ['meta', { property: 'og:title', content: '1MCP Security Features Reference' }]
  - [
      'meta',
      {
        property: 'og:description',
        content: 'Security features for 1MCP including OAuth 2.1 and tags-as-scopes model.',
      },
    ]
---

# Security Features

This document outlines the comprehensive security features implemented in the MCP agent system.

## Tags-as-OAuth-Scopes Security Model

### Core Concept

Tags are mapped to OAuth 2.1 scopes using the format `tag:{tag-name}` (e.g., `tag:web`, `tag:db`). This provides fine-grained access control where clients can only access servers for which they have been explicitly granted scope permissions.

### Security Benefits

- **Fine-grained access control**: Clients only access authorized servers
- **Standards compliance**: Uses OAuth 2.1 scopes properly
- **User consent**: Explicit approval of requested permissions via web interface
- **Fail-secure design**: Denies access on any validation failure
- **Scope expiration**: Scopes expire with access tokens

## Scope Validation Security

### Input Validation (`src/utils/scopeValidation.ts`)

- **Strict format validation**: Only `tag:[a-zA-Z0-9_-]+` patterns allowed
- **Length limits**: Maximum scope and tag length enforcement
- **Injection prevention**: Blocks path traversal, command injection, and special characters
- **Count limits**: Maximum number of scopes per request
- **Duplicate detection**: Prevents duplicate scopes in requests

### Allowlist Approach

- Scopes are validated against available server tags only
- No wildcard or pattern matching allowed
- Fail-secure validation with comprehensive error logging

## Authentication & Authorization

### OAuth 2.1 Implementation (`src/auth/sdkOAuthServerProvider.ts`)

- **PKCE support**: Prevents authorization code interception
- **Client registration**: Dynamic client registration with validation
- **Token management**: Secure token generation, validation, and revocation
- **Session management**: Secure session storage with expiration
- **Web-based consent**: User-friendly consent interface for scope approval

### Scope-Based Authorization Middleware (`src/transport/http/middlewares/scopeAuthMiddleware.ts`)

- **Token verification**: Validates Bearer tokens on every request
- **Scope enforcement**: Ensures requested tags are covered by granted scopes
- **Backward compatibility**: Works seamlessly when auth is disabled
- **Fail-secure design**: Denies access on any error condition

## Rate Limiting

### Multi-tier Rate Limiting

1. **General OAuth endpoints**: Standard rate limiting for OAuth operations
2. **Sensitive operations**: Stricter rate limiting for consent and token operations
3. **Adaptive limits**: Different limits for different operation types

### Rate Limiting Features

- **IP-based limiting**: Prevents abuse from specific addresses
- **Time window controls**: Configurable time windows for rate limits
- **Security logging**: Logs rate limit violations for monitoring
- **Graceful degradation**: Proper error responses when limits exceeded

## Security Middleware (`src/transport/http/middlewares/securityMiddleware.ts`)

### Security Headers

- **X-Frame-Options**: Prevents clickjacking attacks
- **X-Content-Type-Options**: Prevents MIME type sniffing
- **X-XSS-Protection**: Enables XSS protection in browsers
- **Content-Security-Policy**: Restricts resource loading for HTML responses
- **Referrer-Policy**: Controls referrer information leakage

### Input Validation

- **Injection protection**: Detects and blocks common injection patterns
- **Header validation**: Validates all HTTP headers for suspicious content
- **Query parameter validation**: Validates query parameters for malicious content
- **Body validation**: Validates request bodies for POST operations

### Session Security

- **Cache control**: Prevents caching of sensitive responses
- **Robot exclusion**: Prevents indexing of OAuth endpoints
- **Timing attack prevention**: Random delays for authentication endpoints

## Audit Logging

### Comprehensive Audit Trail (`src/utils/scopeValidation.ts`)

- **Scope operations**: All scope validation and authorization events
- **Client identification**: Tracks which clients perform operations
- **Success/failure tracking**: Logs both successful and failed operations
- **Timestamp recording**: Precise timing for all security events

### Security Event Logging

- **Authentication events**: Login attempts, token generation, failures
- **Authorization events**: Scope grants, denials, violations
- **Rate limiting events**: When limits are exceeded
- **Security violations**: Injection attempts, suspicious activity

## Network Security

### Transport Security

- **HTTPS enforcement**: All production traffic over encrypted connections
- **CORS configuration**: Proper cross-origin request handling
- **Request size limits**: Prevents DoS via large requests

### Error Handling

- **Secure error responses**: No sensitive information in error messages
- **Consistent error format**: Standard OAuth 2.1 error format
- **Error logging**: Detailed errors logged server-side only

## Input Sanitization (`src/utils/sanitization.ts`)

### Context-Aware Sanitization

- **HTML escaping**: Prevents XSS in HTML responses
- **URL parameter sanitization**: Safe handling of URL parameters
- **Server name sanitization**: Prevents injection via server names
- **Error message sanitization**: Safe error message display

## Backward Compatibility

### Auth-Disabled Mode

- **Graceful degradation**: Full functionality when auth is disabled
- **Tag filtering preservation**: Original tag filtering when auth off
- **Configuration flexibility**: Runtime auth enable/disable

### Migration Support

- **Incremental adoption**: Can enable auth gradually
- **Existing client support**: Works with non-OAuth clients when auth disabled

## Security Testing

### Comprehensive Test Coverage

- **Unit tests**: Scope validation, middleware functions
- **Integration tests**: Full authentication flows
- **Security tests**: Injection attempts, edge cases, timing attacks
- **Performance tests**: Load testing for rate limiting and validation

### Security Edge Cases

- **Buffer overflow prevention**: Input length validation
- **Null byte injection prevention**: Input format validation
- **Unicode attack prevention**: Character set restrictions
- **Prototype pollution prevention**: Safe object handling

## Security Best Practices

### Development Guidelines

- **Principle of least privilege**: Minimal required scopes granted
- **Fail-secure design**: Default to deny access
- **Defense in depth**: Multiple security layers
- **Regular security audits**: Continuous security monitoring

### Operational Security

- **Secure configuration defaults**: Safe out-of-box configuration
- **Environment-specific settings**: Different security levels per environment
- **Security monitoring**: Real-time security event monitoring
- **Incident response**: Clear procedures for security incidents

## Compliance

### Standards Adherence

- **OAuth 2.1**: Full compliance with OAuth 2.1 specification
- **RFC 7636**: PKCE implementation
- **OWASP Top 10**: Protection against common web vulnerabilities
- **Security headers**: Follows security header best practices

### Privacy Protection

- **Data minimization**: Only necessary data collected and stored
- **Secure storage**: Encrypted session and token storage
- **Access logging**: Audit trail without exposing sensitive data
- **User consent**: Explicit consent for all data access
