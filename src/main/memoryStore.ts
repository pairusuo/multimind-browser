import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ImportMemoryDocumentPayload,
  MemoryDocument,
  MemoryDocumentSummary,
  MemoryImportSource,
  MemoryInboxDocument,
  MemoryInboxItem,
  MemoryInboxStatus,
} from '../shared/types';

interface SourceRow {
  id: string;
  path: string;
  created_at: number;
  last_scanned_at: number | null;
}

interface DocumentRow {
  id: string;
  title: string;
  original_question: string;
  participant_sites_json: string;
  content_markdown: string;
  tags_json: string;
  source_type: string;
  source_path: string | null;
  source_hash: string | null;
  source_mtime: number | null;
  source_size: number | null;
  source_exists: 0 | 1;
  created_at: number;
  updated_at: number;
  imported_at: number;
  version: number;
  archived_at: number | null;
  snippet?: string;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  addImportSource(directoryPath: string): MemoryImportSource {
    const normalizedPath = normalizePath(directoryPath);
    const existing = this.db
      .prepare('SELECT * FROM memory_import_sources WHERE path = ?')
      .get(normalizedPath) as SourceRow | undefined;
    if (existing) {
      return mapSource(existing);
    }

    const source: MemoryImportSource = {
      id: createId('source'),
      path: normalizedPath,
      createdAt: Date.now(),
      lastScannedAt: null,
    };

    this.db.prepare(`
      INSERT INTO memory_import_sources (id, path, created_at, last_scanned_at)
      VALUES (@id, @path, @createdAt, @lastScannedAt)
    `).run(source);

    return source;
  }

  listImportSources(): MemoryImportSource[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_import_sources ORDER BY created_at DESC')
      .all() as SourceRow[];
    return rows.map(mapSource);
  }

  removeImportSource(sourceId: string): void {
    this.db
      .prepare('DELETE FROM memory_import_sources WHERE id = ?')
      .run(sourceId);
  }

  async scanInbox(): Promise<MemoryInboxItem[]> {
    const sources = this.listImportSources();
    const items: MemoryInboxItem[] = [];

    for (const source of sources) {
      const files = await listMarkdownFiles(source.path);
      for (const filePath of files) {
        const item = await this.buildInboxItem(source, filePath);
        if (item) {
          items.push(item);
        }
      }

      this.db.prepare(`
        UPDATE memory_import_sources
        SET last_scanned_at = ?
        WHERE id = ?
      `).run(Date.now(), source.id);
    }

    await this.markMissingSources();

    return items.sort((a, b) => {
      if (a.status !== b.status) {
        return inboxStatusWeight(a.status) - inboxStatusWeight(b.status);
      }
      return b.mtimeMs - a.mtimeMs;
    });
  }

  async getInboxDocument(filePath: string): Promise<MemoryInboxDocument> {
    const source = this.findSourceForPath(filePath);
    if (!source) {
      throw new Error('File is not in an authorized memory directory.');
    }

    const item = await this.buildInboxItem(source, filePath);
    if (!item) {
      throw new Error('Markdown file could not be read.');
    }

    const contentMarkdown = await fs.readFile(filePath, 'utf8');
    return {
      item,
      contentMarkdown,
      suggestedTitle: extractMarkdownTitle(contentMarkdown, item.fileName),
    };
  }

  async importDocument(payload: ImportMemoryDocumentPayload): Promise<MemoryDocument> {
    const now = Date.now();
    const filePath = payload.filePath ? normalizePath(payload.filePath) : null;
    const source = filePath ? this.findSourceForPath(filePath) : null;
    if (filePath && !source) {
      throw new Error('File is not in an authorized memory directory.');
    }

    const fileSnapshot = filePath ? await readFileSnapshot(filePath) : null;
    const contentMarkdown = (payload.contentMarkdown ?? fileSnapshot?.content ?? '').trim();
    if (!contentMarkdown) {
      throw new Error('Memory document content is empty.');
    }

    const title = (payload.title || extractMarkdownTitle(contentMarkdown, filePath ? path.basename(filePath) : 'Untitled')).trim();
    const sourceHash = fileSnapshot?.hash ?? hashText(contentMarkdown);
    const existingByHash = this.findDocumentByHash(sourceHash);
    if (existingByHash && existingByHash.source_path !== filePath) {
      return mapDocument(existingByHash);
    }

    const existingByPath = filePath ? this.findDocumentByPath(filePath) : undefined;
    if (existingByPath) {
      const nextVersion = existingByPath.version + (existingByPath.source_hash === sourceHash ? 0 : 1);
      const updated = {
        id: existingByPath.id,
        title,
        original_question: payload.originalQuestion?.trim() ?? existingByPath.original_question,
        participant_sites_json: JSON.stringify(payload.participantSites ?? parseJsonArray(existingByPath.participant_sites_json)),
        content_markdown: contentMarkdown,
        tags_json: JSON.stringify(payload.tags ?? parseJsonArray(existingByPath.tags_json)),
        source_hash: sourceHash,
        source_mtime: fileSnapshot?.mtimeMs ?? existingByPath.source_mtime,
        source_size: fileSnapshot?.size ?? existingByPath.source_size,
        source_exists: 1,
        updated_at: now,
        version: nextVersion,
      };

      this.db.prepare(`
        UPDATE memory_documents
        SET title = @title,
            original_question = @original_question,
            participant_sites_json = @participant_sites_json,
            content_markdown = @content_markdown,
            tags_json = @tags_json,
            source_hash = @source_hash,
            source_mtime = @source_mtime,
            source_size = @source_size,
            source_exists = @source_exists,
            updated_at = @updated_at,
            version = @version,
            archived_at = NULL
        WHERE id = @id
      `).run(updated);
      this.insertVersion(updated.id, nextVersion, contentMarkdown, sourceHash, now);
      this.upsertFts(updated.id, title, updated.original_question, contentMarkdown);
      return this.getDocument(updated.id) as MemoryDocument;
    }

    const id = createId('memory');
    const row = {
      id,
      title,
      original_question: payload.originalQuestion?.trim() ?? '',
      participant_sites_json: JSON.stringify(payload.participantSites ?? []),
      content_markdown: contentMarkdown,
      tags_json: JSON.stringify(payload.tags ?? []),
      source_type: filePath ? 'directory-import' : 'manual-paste',
      source_path: filePath,
      source_hash: sourceHash,
      source_mtime: fileSnapshot?.mtimeMs ?? null,
      source_size: fileSnapshot?.size ?? null,
      source_exists: filePath ? 1 : 0,
      created_at: now,
      updated_at: now,
      imported_at: now,
      version: 1,
      archived_at: null,
    };

    this.db.prepare(`
      INSERT INTO memory_documents (
        id, title, original_question, participant_sites_json, content_markdown,
        tags_json, source_type, source_path, source_hash, source_mtime, source_size,
        source_exists, created_at, updated_at, imported_at, version, archived_at
      )
      VALUES (
        @id, @title, @original_question, @participant_sites_json, @content_markdown,
        @tags_json, @source_type, @source_path, @source_hash, @source_mtime, @source_size,
        @source_exists, @created_at, @updated_at, @imported_at, @version, @archived_at
      )
    `).run(row);
    this.insertVersion(id, 1, contentMarkdown, sourceHash, now);
    this.upsertFts(id, title, row.original_question, contentMarkdown);
    return this.getDocument(id) as MemoryDocument;
  }

  searchDocuments(query: string): MemoryDocumentSummary[] {
    const trimmed = query.trim();
    if (!trimmed) {
      const rows = this.db.prepare(`
        SELECT *
        FROM memory_documents
        WHERE archived_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 80
      `).all() as DocumentRow[];
      return rows.map(mapDocumentSummary);
    }

    try {
      const rows = this.db.prepare(`
        SELECT d.*, snippet(memory_documents_fts, 3, '<mark>', '</mark>', '...', 16) AS snippet
        FROM memory_documents_fts f
        JOIN memory_documents d ON d.id = f.id
        WHERE memory_documents_fts MATCH ?
          AND d.archived_at IS NULL
        ORDER BY rank
        LIMIT 80
      `).all(buildFtsQuery(trimmed)) as DocumentRow[];
      return rows.map(mapDocumentSummary);
    } catch {
      const like = `%${trimmed}%`;
      const rows = this.db.prepare(`
        SELECT *
        FROM memory_documents
        WHERE archived_at IS NULL
          AND (title LIKE ? OR original_question LIKE ? OR content_markdown LIKE ?)
        ORDER BY updated_at DESC
        LIMIT 80
      `).all(like, like, like) as DocumentRow[];
      return rows.map(mapDocumentSummary);
    }
  }

  getDocument(id: string): MemoryDocument | null {
    const row = this.db
      .prepare('SELECT * FROM memory_documents WHERE id = ? AND archived_at IS NULL')
      .get(id) as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  }

  deleteDocument(id: string): void {
    this.db.prepare(`
      UPDATE memory_documents
      SET archived_at = ?, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), Date.now(), id);
    this.db.prepare('DELETE FROM memory_documents_fts WHERE id = ?').run(id);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_import_sources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_scanned_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS memory_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_question TEXT NOT NULL DEFAULT '',
        participant_sites_json TEXT NOT NULL DEFAULT '[]',
        content_markdown TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL,
        source_path TEXT,
        source_hash TEXT,
        source_mtime REAL,
        source_size INTEGER,
        source_exists INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        archived_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS memory_document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_markdown TEXT NOT NULL,
        source_hash TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES memory_documents(id) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_documents_fts
      USING fts5(id UNINDEXED, title, original_question, content_markdown);

      CREATE INDEX IF NOT EXISTS idx_memory_documents_source_path
      ON memory_documents(source_path);

      CREATE INDEX IF NOT EXISTS idx_memory_documents_source_hash
      ON memory_documents(source_hash);
    `);
  }

  private async buildInboxItem(source: MemoryImportSource, filePath: string): Promise<MemoryInboxItem | null> {
    try {
      const snapshot = await readFileSnapshot(filePath);
      const existingByPath = this.findDocumentByPath(filePath);
      const existingByHash = this.findDocumentByHash(snapshot.hash);
      const status: MemoryInboxStatus = existingByPath
        ? existingByPath.source_hash === snapshot.hash ? 'imported' : 'modified'
        : existingByHash ? 'imported' : 'new';

      return {
        sourceId: source.id,
        sourcePath: source.path,
        filePath,
        fileName: path.basename(filePath),
        title: extractMarkdownTitle(snapshot.content, path.basename(filePath)),
        hash: snapshot.hash,
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        status,
        existingDocumentId: existingByPath?.id ?? existingByHash?.id,
      };
    } catch {
      return null;
    }
  }

  private findSourceForPath(filePath: string): MemoryImportSource | null {
    const normalizedFilePath = normalizePath(filePath);
    return this.listImportSources().find((source) => isPathInside(source.path, normalizedFilePath)) ?? null;
  }

  private findDocumentByPath(filePath: string): DocumentRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_documents WHERE source_path = ? AND archived_at IS NULL')
      .get(normalizePath(filePath)) as DocumentRow | undefined;
  }

  private findDocumentByHash(hash: string): DocumentRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_documents WHERE source_hash = ? AND archived_at IS NULL')
      .get(hash) as DocumentRow | undefined;
  }

  private insertVersion(documentId: string, version: number, contentMarkdown: string, sourceHash: string, createdAt: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_document_versions (
        id, document_id, version, content_markdown, source_hash, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`${documentId}:v${version}`, documentId, version, contentMarkdown, sourceHash, createdAt);
  }

  private upsertFts(id: string, title: string, originalQuestion: string, contentMarkdown: string): void {
    this.db.prepare('DELETE FROM memory_documents_fts WHERE id = ?').run(id);
    this.db.prepare(`
      INSERT INTO memory_documents_fts (id, title, original_question, content_markdown)
      VALUES (?, ?, ?, ?)
    `).run(id, title, originalQuestion, contentMarkdown);
  }

  private async markMissingSources(): Promise<void> {
    const rows = this.db
      .prepare('SELECT * FROM memory_documents WHERE source_path IS NOT NULL AND archived_at IS NULL')
      .all() as DocumentRow[];

    for (const row of rows) {
      const exists = row.source_path ? await fileExists(row.source_path) : false;
      if ((exists ? 1 : 0) !== row.source_exists) {
        this.db.prepare(`
          UPDATE memory_documents
          SET source_exists = ?, updated_at = ?
          WHERE id = ?
        `).run(exists ? 1 : 0, Date.now(), row.id);
      }
    }
  }
}

async function listMarkdownFiles(directoryPath: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [directoryPath];

  while (stack.length) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        files.push(normalizePath(entryPath));
      }
    }
  }

  return files;
}

async function readFileSnapshot(filePath: string): Promise<{
  content: string;
  hash: string;
  mtimeMs: number;
  size: number;
}> {
  const normalizedPath = normalizePath(filePath);
  const [content, stat] = await Promise.all([
    fs.readFile(normalizedPath, 'utf8'),
    fs.stat(normalizedPath),
  ]);

  return {
    content,
    hash: hashText(content),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function extractMarkdownTitle(markdown: string, fallbackName: string): string {
  const heading = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));
  if (heading) {
    return heading.replace(/^#\s+/, '').trim();
  }
  return fallbackName.replace(/\.(md|markdown)$/i, '').trim() || 'Untitled';
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function buildFtsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

function inboxStatusWeight(status: MemoryInboxStatus): number {
  if (status === 'new') return 0;
  if (status === 'modified') return 1;
  return 2;
}

function mapSource(row: SourceRow): MemoryImportSource {
  return {
    id: row.id,
    path: row.path,
    createdAt: row.created_at,
    lastScannedAt: row.last_scanned_at,
  };
}

function mapDocumentSummary(row: DocumentRow): MemoryDocumentSummary {
  return {
    id: row.id,
    title: row.title,
    originalQuestion: row.original_question,
    tags: parseJsonArray(row.tags_json),
    participantSites: parseJsonArray(row.participant_sites_json),
    sourceType: row.source_type,
    sourcePath: row.source_path,
    sourceExists: row.source_exists === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    importedAt: row.imported_at,
    version: row.version,
    snippet: row.snippet,
  };
}

function mapDocument(row: DocumentRow): MemoryDocument {
  return {
    ...mapDocumentSummary(row),
    contentMarkdown: row.content_markdown,
    sourceHash: row.source_hash,
    sourceMtime: row.source_mtime,
    sourceSize: row.source_size,
  };
}
