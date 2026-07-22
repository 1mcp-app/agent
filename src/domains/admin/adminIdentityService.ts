import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const ADMIN_STATE_DIR = 'admin';
const ADMIN_STATE_VERSION = 1;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const ADMIN_SESSION_COOKIE_NAME = '1mcp_admin_session';

export interface AdminAccount {
  id: string;
  runtimeScopeId: string;
  username: string;
  role: 'full-admin';
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredAdminAccount extends AdminAccount {
  passwordHash: string;
}

interface StoredAdminSession {
  id: string;
  runtimeScopeId: string;
  accountId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

interface AdminState {
  schemaVersion: 1;
  runtimeScopeId: string;
  accounts: StoredAdminAccount[];
  sessions: StoredAdminSession[];
}

interface AdminIdentityServiceOptions {
  runtimeScopeId: string;
  storageDir: string;
  now?: () => Date;
  sessionTtlMs?: number;
  createId?: () => string;
  randomToken?: (byteLength: number) => string;
}

interface BootstrapFirstAdminInput {
  username: string;
  password: string;
}

interface LoginInput {
  username: string;
  password: string;
}

interface LoginResult {
  account: AdminAccount;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

interface ValidatedSession {
  account: AdminAccount;
  csrfToken: string;
  expiresAt: string;
}

export class AdminIdentityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminIdentityError';
  }
}

export class AdminIdentityService {
  private readonly runtimeScopeId: string;
  private readonly storageDir: string;
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;
  private readonly createId: () => string;
  private readonly randomToken: (byteLength: number) => string;

  constructor(options: AdminIdentityServiceOptions) {
    this.runtimeScopeId = options.runtimeScopeId;
    this.storageDir = path.join(options.storageDir, ADMIN_STATE_DIR);
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.createId = options.createId ?? randomUUID;
    this.randomToken = options.randomToken ?? ((byteLength) => randomBytes(byteLength).toString('base64url'));
  }

  hasAdminAccount(): boolean {
    return this.readState().accounts.length > 0;
  }

  async bootstrapFirstAdmin(input: BootstrapFirstAdminInput): Promise<AdminAccount> {
    const state = this.readState();
    if (state.accounts.length > 0) {
      throw new AdminIdentityError('admin_account_exists', 'An admin account already exists');
    }

    const now = this.now().toISOString();
    const username = this.normalizeUsername(input.username);
    const passwordHash = await this.hashPassword(input.password);
    const latestState = this.readState();
    if (latestState.accounts.length > 0) {
      throw new AdminIdentityError('admin_account_exists', 'An admin account already exists');
    }

    const account: StoredAdminAccount = {
      id: `admin_acct_${this.createId()}`,
      runtimeScopeId: this.runtimeScopeId,
      username,
      passwordHash,
      role: 'full-admin',
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    this.writeState({ ...latestState, accounts: [account] });
    return toPublicAccount(account);
  }

  bootstrapFirstAdminFromEnvironment(
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  ): AdminAccount | null {
    const username = env.ONE_MCP_ADMIN_USERNAME;
    const password = env.ONE_MCP_ADMIN_PASSWORD;

    if (!username && !password) {
      return null;
    }
    if (!username || !password) {
      throw new AdminIdentityError(
        'admin_bootstrap_env_incomplete',
        'Both ONE_MCP_ADMIN_USERNAME and ONE_MCP_ADMIN_PASSWORD are required for admin bootstrap',
      );
    }

    const state = this.readState();
    if (state.accounts.length > 0) {
      return null;
    }

    const now = this.now().toISOString();
    const account: StoredAdminAccount = {
      id: `admin_acct_${this.createId()}`,
      runtimeScopeId: this.runtimeScopeId,
      username: this.normalizeUsername(username),
      passwordHash: this.hashPasswordSync(password),
      role: 'full-admin',
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    this.writeState({ ...state, accounts: [account] });
    return toPublicAccount(account);
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const state = this.readState();
    const username = this.normalizeUsername(input.username);
    const account = state.accounts.find((candidate) => candidate.username === username && !candidate.disabled);

    if (!account || !(await this.verifyPassword(input.password, account.passwordHash))) {
      throw new AdminIdentityError('invalid_credentials', 'Invalid admin credentials');
    }

    const latestState = this.readState();
    const latestAccount = latestState.accounts.find(
      (candidate) =>
        candidate.id === account.id &&
        candidate.runtimeScopeId === this.runtimeScopeId &&
        candidate.username === username &&
        !candidate.disabled &&
        candidate.passwordHash === account.passwordHash,
    );
    if (!latestAccount) {
      throw new AdminIdentityError('invalid_credentials', 'Invalid admin credentials');
    }

    const sessionToken = `admin_sess_${this.randomToken(SESSION_TOKEN_BYTES)}`;
    const csrfToken = `admin_csrf_${this.randomToken(CSRF_TOKEN_BYTES)}`;
    const now = this.now();
    const session: StoredAdminSession = {
      id: `admin_session_${this.createId()}`,
      runtimeScopeId: this.runtimeScopeId,
      accountId: latestAccount.id,
      tokenHash: hashSecret(sessionToken),
      csrfToken,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
    };

    this.writeState({ ...latestState, sessions: [...latestState.sessions, session] });

    return {
      account: toPublicAccount(latestAccount),
      sessionToken,
      csrfToken,
      expiresAt: session.expiresAt,
    };
  }

  validateSession(sessionToken: string | undefined): ValidatedSession | null {
    if (!sessionToken) {
      return null;
    }

    const state = this.readState();
    const session = this.findValidSession(state, sessionToken);
    if (!session) {
      return null;
    }

    const account = state.accounts.find(
      (candidate) => candidate.id === session.accountId && candidate.runtimeScopeId === this.runtimeScopeId,
    );
    if (!account || account.disabled) {
      return null;
    }

    return {
      account: toPublicAccount(account),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  }

  validateCsrf(sessionToken: string | undefined, csrfToken: string | string[] | undefined): boolean {
    if (!sessionToken || !csrfToken || Array.isArray(csrfToken)) {
      return false;
    }

    const state = this.readState();
    const session = this.findValidSession(state, sessionToken);
    if (!session) {
      return false;
    }

    return safeEqual(csrfToken, session.csrfToken);
  }

  revokeSession(sessionToken: string | undefined): void {
    if (!sessionToken) {
      return;
    }

    const state = this.readState();
    const tokenHash = hashSecret(sessionToken);
    const revokedAt = this.now().toISOString();
    this.writeState({
      ...state,
      sessions: state.sessions.map((session) =>
        safeEqual(session.tokenHash, tokenHash) && !session.revokedAt ? { ...session, revokedAt } : session,
      ),
    });
  }

  revokeAllSessions(): void {
    const state = this.readState();
    const revokedAt = this.now().toISOString();
    this.writeState({
      ...state,
      sessions: state.sessions.map((session) => (session.revokedAt ? session : { ...session, revokedAt })),
    });
  }

  async changePassword(accountId: string, password: string): Promise<AdminAccount> {
    const state = this.readState();
    const account = this.requireAccount(state, accountId);
    const passwordHash = await this.hashPassword(password);
    const latestState = this.readState();
    const latestAccount = this.requireAccount(latestState, account.id);
    const updatedAccount = {
      ...latestAccount,
      passwordHash,
      updatedAt: this.now().toISOString(),
    };

    this.writeState({
      ...latestState,
      accounts: latestState.accounts.map((candidate) => (candidate.id === account.id ? updatedAccount : candidate)),
      sessions: this.revokeSessionsForAccount(latestState.sessions, account.id),
    });

    return toPublicAccount(updatedAccount);
  }

  disableAccount(accountId: string): AdminAccount {
    const state = this.readState();
    const account = this.requireAccount(state, accountId);
    const updatedAccount = {
      ...account,
      disabled: true,
      updatedAt: this.now().toISOString(),
    };

    this.writeState({
      ...state,
      accounts: state.accounts.map((candidate) => (candidate.id === account.id ? updatedAccount : candidate)),
      sessions: this.revokeSessionsForAccount(state.sessions, account.id),
    });

    return toPublicAccount(updatedAccount);
  }

  deleteAccount(accountId: string): void {
    const state = this.readState();
    const account = this.requireAccount(state, accountId);
    this.writeState({
      ...state,
      accounts: state.accounts.filter((candidate) => candidate.id !== account.id),
      sessions: this.revokeSessionsForAccount(state.sessions, account.id),
    });
  }

  private findValidSession(state: AdminState, sessionToken: string): StoredAdminSession | null {
    const tokenHash = hashSecret(sessionToken);
    const session = state.sessions.find(
      (candidate) =>
        candidate.runtimeScopeId === this.runtimeScopeId &&
        !candidate.revokedAt &&
        new Date(candidate.expiresAt).getTime() > this.now().getTime() &&
        safeEqual(candidate.tokenHash, tokenHash),
    );
    return session ?? null;
  }

  private requireAccount(state: AdminState, accountId: string): StoredAdminAccount {
    const account = state.accounts.find(
      (candidate) => candidate.id === accountId && candidate.runtimeScopeId === this.runtimeScopeId,
    );
    if (!account) {
      throw new AdminIdentityError('admin_account_not_found', 'Admin account not found');
    }
    return account;
  }

  private revokeSessionsForAccount(sessions: StoredAdminSession[], accountId: string): StoredAdminSession[] {
    const revokedAt = this.now().toISOString();
    return sessions.map((session) =>
      session.accountId === accountId && !session.revokedAt ? { ...session, revokedAt } : session,
    );
  }

  private normalizeUsername(username: string): string {
    const normalized = username.trim();
    if (!normalized) {
      throw new AdminIdentityError('invalid_username', 'Admin username is required');
    }
    return normalized;
  }

  private async hashPassword(password: string): Promise<string> {
    this.validatePassword(password);
    const salt = randomBytes(PASSWORD_SALT_LENGTH).toString('base64url');
    const key = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return `scrypt:v1:${salt}:${key.toString('base64url')}`;
  }

  private hashPasswordSync(password: string): string {
    this.validatePassword(password);
    const salt = randomBytes(PASSWORD_SALT_LENGTH).toString('base64url');
    const key = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
    return `scrypt:v1:${salt}:${key.toString('base64url')}`;
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [algorithm, version, salt, encodedHash] = passwordHash.split(':');
    if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !encodedHash) {
      return false;
    }

    const expected = Buffer.from(encodedHash, 'base64url');
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private validatePassword(password: string): void {
    if (password.length < 12) {
      throw new AdminIdentityError('weak_password', 'Admin password must be at least 12 characters');
    }
  }

  private readState(): AdminState {
    const filePath = this.stateFilePath();
    if (!fs.existsSync(filePath)) {
      return this.emptyState();
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AdminState;
    if (parsed.runtimeScopeId !== this.runtimeScopeId) {
      throw new AdminIdentityError('runtime_scope_mismatch', 'Admin state belongs to a different runtime scope');
    }
    return parsed;
  }

  private writeState(state: AdminState): void {
    fs.mkdirSync(this.storageDir, { recursive: true });
    const filePath = this.stateFilePath();
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  }

  private emptyState(): AdminState {
    return {
      schemaVersion: ADMIN_STATE_VERSION,
      runtimeScopeId: this.runtimeScopeId,
      accounts: [],
      sessions: [],
    };
  }

  private stateFilePath(): string {
    return path.join(this.storageDir, `admin-state-${hashSecret(this.runtimeScopeId).slice(0, 24)}.json`);
  }
}

function toPublicAccount(account: StoredAdminAccount): AdminAccount {
  return {
    id: account.id,
    runtimeScopeId: account.runtimeScopeId,
    username: account.username,
    role: account.role,
    disabled: account.disabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
