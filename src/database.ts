import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const migrations = [String.raw`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL CHECK(capacity BETWEEN 2 AND 32),
    version TEXT NOT NULL DEFAULT '', loader TEXT NOT NULL DEFAULT '原版',
    port INTEGER CHECK(port IS NULL OR port BETWEEN 1024 AND 65535),
    password TEXT, created_at INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX rooms_owner ON rooms(owner_id, closed);
  CREATE TABLE members (
    room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id),
    joined_at INTEGER NOT NULL, PRIMARY KEY(room_id, user_id)
  ) STRICT;
  CREATE INDEX members_user ON members(user_id, room_id);
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id),
    at INTEGER NOT NULL, message TEXT NOT NULL
  ) STRICT;
  CREATE INDEX events_room ON events(room_id, seq);
  CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
  INSERT INTO metadata VALUES ('revision', 0);
`, String.raw`
  CREATE TABLE accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id), username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
  ) STRICT;
`, String.raw`
  CREATE TABLE friendships (
    low_id TEXT NOT NULL REFERENCES accounts(user_id), high_id TEXT NOT NULL REFERENCES accounts(user_id),
    requester TEXT NOT NULL REFERENCES accounts(user_id), status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
    created_at INTEGER NOT NULL, PRIMARY KEY(low_id, high_id), CHECK(low_id < high_id), CHECK(requester=low_id OR requester=high_id)
  ) STRICT;
  CREATE INDEX friendships_high ON friendships(high_id);
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, low_id TEXT NOT NULL, high_id TEXT NOT NULL,
    sender_id TEXT NOT NULL REFERENCES accounts(user_id), recipient_id TEXT NOT NULL REFERENCES accounts(user_id),
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000), created_at INTEGER NOT NULL, client_id TEXT NOT NULL,
    UNIQUE(sender_id,client_id), FOREIGN KEY(low_id,high_id) REFERENCES friendships(low_id,high_id)
  ) STRICT;
  CREATE INDEX messages_pair ON messages(low_id,high_id,id);
  CREATE TABLE read_cursors (
    user_id TEXT NOT NULL REFERENCES accounts(user_id), peer_id TEXT NOT NULL REFERENCES accounts(user_id),
    last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,peer_id)
  ) STRICT;
`, String.raw`
  CREATE TABLE voice_groups (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX voice_groups_room ON voice_groups(room_id);
  INSERT INTO voice_groups SELECT 'game-' || id,id,'游戏',1,0,created_at FROM rooms;
  CREATE TABLE room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id),
    sender_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
    client_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(sender_id,client_id)
  ) STRICT;
  CREATE INDEX room_messages_room ON room_messages(room_id,id);
  CREATE TABLE room_reads (
    room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id),
    last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(room_id,user_id)
  ) STRICT;
  CREATE TABLE voice_rules (
    room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id),
    muted INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(room_id,user_id)
  ) STRICT;
  CREATE TABLE voice_leases (
    identity TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL,
    room_id TEXT NOT NULL REFERENCES rooms(id), group_id TEXT NOT NULL REFERENCES voice_groups(id),
    expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX voice_leases_user ON voice_leases(user_id);
`, String.raw`
  CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id), avatar_id TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '' CHECK(length(bio)<=240), updated_at INTEGER NOT NULL
  ) STRICT;
`, String.raw`
  CREATE TABLE room_packs (room_id TEXT PRIMARY KEY REFERENCES rooms(id), summary TEXT NOT NULL, archive BLOB NOT NULL CHECK(length(archive)<=16777216), updated_at INTEGER NOT NULL) STRICT;
`];

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
    if (version > migrations.length) { this.db.close(); throw new Error('数据库版本高于当前程序版本，禁止降级写入'); }
    for (let i = version; i < migrations.length; i++) {
      this.transaction(() => { this.db.exec(migrations[i]!); this.db.exec(`PRAGMA user_version=${i + 1}`); });
    }
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]) { return this.db.prepare(sql).run(...params); }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  revision() { return this.get<{ value: number }>("SELECT value FROM metadata WHERE key='revision'")!.value; }
  bump() { this.run("UPDATE metadata SET value=value+1 WHERE key='revision'"); }
  prune(now: number) {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.run('DELETE FROM rate_limits WHERE reset_at <= ?', now);
  }
  close() { this.db.close(); }
}
