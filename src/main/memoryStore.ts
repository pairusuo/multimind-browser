import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAgentMemoryContext } from './agentMemoryContext';
import {
  extractMeaningfulCjkChars,
  extractRecallTerms,
  inferMemoryType,
  memoryScopeWeight,
  memoryTypeWeight,
  normalizeMemoryDocumentType,
  normalizeMemoryScope,
  scoreRecallCandidate,
} from './memoryRecallRules';
import {
  ImportMemoryDocumentPayload,
  MemoryDocument,
  MemoryDocumentSummary,
  MemoryDocumentType,
  MemoryScope,
  MemoryImportSource,
  MemoryInboxDocument,
  MemoryInboxItem,
  MemoryInboxStatus,
  MemoryRecallContext,
  MemoryRecallItem,
} from '../shared/types';

const MEMORY_RECALL_LIMIT = 3;
const MEMORY_RECALL_EXCERPT_CHARS = 700;
const MEMORY_RECALL_CONTEXT_CHARS = 2400;

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
  memory_type: MemoryDocumentType;
  memory_scope: MemoryScope;
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

    return dedupeInboxItems(items).sort((a, b) => {
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

    const { content: contentMarkdown } = await readFileSnapshot(filePath);
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
    const contentMarkdown = normalizeMemoryMarkdown(payload.contentMarkdown ?? fileSnapshot?.content ?? '');
    if (!contentMarkdown) {
      throw new Error('Memory document content is empty.');
    }

    const title = (payload.title || extractMarkdownTitle(contentMarkdown, filePath ? path.basename(filePath) : 'Untitled')).trim();
    const memoryType = payload.memoryType ?? inferMemoryType(title, payload.tags ?? [], contentMarkdown);
    const memoryScope = normalizeMemoryScope(payload.memoryScope);
    const sourceHash = fileSnapshot?.hash ?? hashText(contentMarkdown);
    const existingByHash = this.findDocumentByHash(sourceHash);
    if (existingByHash && existingByHash.source_path !== filePath) {
      return mapDocument(existingByHash);
    }

    const existingByPath = filePath ? this.findDocumentByPath(filePath) : undefined;
    const disabledByPath = filePath ? this.findDisabledDocumentByPath(filePath) : undefined;
    const disabledByHash = this.findDisabledDocumentByHash(sourceHash);
    const documentToUpdate = existingByPath ?? disabledByPath ?? disabledByHash;
    if (documentToUpdate) {
      const nextVersion = documentToUpdate.version + (documentToUpdate.source_hash === sourceHash ? 0 : 1);
      const updated = {
        id: documentToUpdate.id,
        title,
        memory_type: memoryType,
        memory_scope: memoryScope,
        original_question: payload.originalQuestion?.trim() ?? documentToUpdate.original_question,
        participant_sites_json: JSON.stringify(payload.participantSites ?? parseJsonArray(documentToUpdate.participant_sites_json)),
        content_markdown: contentMarkdown,
        tags_json: JSON.stringify(payload.tags ?? parseJsonArray(documentToUpdate.tags_json)),
        source_type: filePath ? 'directory-import' : documentToUpdate.source_type,
        source_path: filePath ?? documentToUpdate.source_path,
        source_hash: sourceHash,
        source_mtime: fileSnapshot?.mtimeMs ?? documentToUpdate.source_mtime,
        source_size: fileSnapshot?.size ?? documentToUpdate.source_size,
        source_exists: 1,
        updated_at: now,
        version: nextVersion,
      };

      this.db.prepare(`
        UPDATE memory_documents
        SET title = @title,
            memory_type = @memory_type,
            memory_scope = @memory_scope,
            original_question = @original_question,
            participant_sites_json = @participant_sites_json,
            content_markdown = @content_markdown,
            tags_json = @tags_json,
            source_type = @source_type,
            source_path = @source_path,
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
      memory_type: memoryType,
      memory_scope: memoryScope,
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
        memory_type, memory_scope, tags_json, source_type, source_path, source_hash, source_mtime, source_size,
        source_exists, created_at, updated_at, imported_at, version, archived_at
      )
      VALUES (
        @id, @title, @original_question, @participant_sites_json, @content_markdown,
        @memory_type, @memory_scope, @tags_json, @source_type, @source_path, @source_hash, @source_mtime, @source_size,
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
      if (rows.length) {
        return rows.map(mapDocumentSummary);
      }
    } catch {
      // Fall back to substring search below. FTS5 tokenization is weak for short CJK queries.
    }

    const like = `%${trimmed}%`;
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_documents
      WHERE archived_at IS NULL
        AND (title LIKE ? OR original_question LIKE ? OR content_markdown LIKE ? OR tags_json LIKE ?)
      ORDER BY updated_at DESC
      LIMIT 80
    `).all(like, like, like, like) as DocumentRow[];
    return rows.map(mapDocumentSummary);
  }

  recallForAgentTask(query: string): MemoryRecallContext {
    const trimmed = query.trim();
    if (!trimmed) {
      return { items: [], agentContext: '' };
    }

    const items = this.findRecallCandidates(trimmed)
      .map((summary): MemoryRecallItem | null => {
        const document = this.getDocument(summary.id);
        if (!document) {
          return null;
        }
        const excerpt = createRecallExcerpt(document.contentMarkdown, trimmed, MEMORY_RECALL_EXCERPT_CHARS);
        if (!excerpt) {
          return null;
        }
        const ranking = scoreRecallCandidate(document, trimmed);
        if (ranking.score <= 0) {
          return null;
        }
        return {
          id: document.id,
          title: document.title,
          memoryType: document.memoryType,
          memoryScope: document.memoryScope,
          tags: document.tags,
          score: ranking.score,
          matchReasons: ranking.matchReasons,
          excerpt,
        };
      })
      .filter((item): item is MemoryRecallItem => item !== null)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        const typeDelta = memoryTypeWeight(left.memoryType) - memoryTypeWeight(right.memoryType);
        if (typeDelta !== 0) {
          return typeDelta;
        }
        return memoryScopeWeight(left.memoryScope) - memoryScopeWeight(right.memoryScope);
      })
      .slice(0, MEMORY_RECALL_LIMIT);

    if (!items.length) {
      return { items: [], agentContext: '' };
    }

    return {
      items,
      agentContext: buildAgentMemoryContext(items, trimmed, MEMORY_RECALL_CONTEXT_CHARS),
    };
  }

  private findRecallCandidates(query: string): MemoryDocumentSummary[] {
    const byId = new Map<string, MemoryDocumentSummary>();
    const addResults = (results: MemoryDocumentSummary[]) => {
      for (const result of results) {
        if (!byId.has(result.id)) {
          byId.set(result.id, result);
        }
      }
    };

    addResults(this.searchDocuments(query));

    for (const term of extractRecallTerms(query).slice(0, 24)) {
      addResults(this.searchDocuments(term));
    }

    for (const char of extractMeaningfulCjkChars(query).slice(0, 24)) {
      addResults(this.searchDocuments(char));
    }

    return [...byId.values()];
  }

  getDocument(id: string): MemoryDocument | null {
    const row = this.db
      .prepare('SELECT * FROM memory_documents WHERE id = ? AND archived_at IS NULL')
      .get(id) as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  }

  disableDocument(id: string): void {
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
        memory_type TEXT NOT NULL DEFAULT 'reference',
        memory_scope TEXT NOT NULL DEFAULT 'global',
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

    ensureColumn(this.db, 'memory_documents', 'memory_type', "TEXT NOT NULL DEFAULT 'reference'");
    ensureColumn(this.db, 'memory_documents', 'memory_scope', "TEXT NOT NULL DEFAULT 'global'");
  }

  private async buildInboxItem(source: MemoryImportSource, filePath: string): Promise<MemoryInboxItem | null> {
    try {
      const snapshot = await readFileSnapshot(filePath);
      const existingByPath = this.findDocumentByPath(filePath);
      const existingByHash = this.findDocumentByHash(snapshot.hash);
      const disabledByPath = this.findDisabledDocumentByPath(filePath);
      const disabledByHash = this.findDisabledDocumentByHash(snapshot.hash);
      const status: MemoryInboxStatus = existingByPath
        ? existingByPath.source_hash === snapshot.hash ? 'imported' : 'modified'
        : existingByHash ? 'imported'
          : disabledByPath || disabledByHash ? 'disabled'
            : 'new';

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
        existingDocumentId: existingByPath?.id ?? existingByHash?.id ?? disabledByPath?.id ?? disabledByHash?.id,
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

  private findDisabledDocumentByPath(filePath: string): DocumentRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_documents WHERE source_path = ? AND archived_at IS NOT NULL')
      .get(normalizePath(filePath)) as DocumentRow | undefined;
  }

  private findDisabledDocumentByHash(hash: string): DocumentRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_documents WHERE source_hash = ? AND archived_at IS NOT NULL')
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
    content: normalizeMemoryMarkdown(content),
    hash: hashText(normalizeMemoryMarkdown(content)),
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

function normalizeMemoryMarkdown(content: string): string {
  const trimmed = content.trim();
  const fencedMarkdown = trimmed.match(/^```(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  return dedupeLeadingMarkdownTitle(fencedMarkdown ? fencedMarkdown[1].trim() : trimmed);
}

function dedupeLeadingMarkdownTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstHeadingIndex = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (firstHeadingIndex < 0) {
    return markdown;
  }

  const firstHeading = lines[firstHeadingIndex].trim();
  let index = firstHeadingIndex + 1;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }

  if (lines[index]?.trim() !== firstHeading) {
    return markdown;
  }

  const nextLines = [...lines];
  nextLines.splice(index, 1);
  if (!nextLines[index]?.trim() && !nextLines[index - 1]?.trim()) {
    nextLines.splice(index, 1);
  }
  return nextLines.join('\n').trim();
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

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

function inboxStatusWeight(status: MemoryInboxStatus): number {
  if (status === 'new') return 0;
  if (status === 'modified') return 1;
  if (status === 'disabled') return 2;
  return 3;
}

function dedupeInboxItems(items: MemoryInboxItem[]): MemoryInboxItem[] {
  const byHash = new Map<string, MemoryInboxItem>();

  items.forEach((item) => {
    const existing = byHash.get(item.hash);
    if (!existing || shouldReplaceInboxItem(existing, item)) {
      byHash.set(item.hash, item);
    }
  });

  return [...byHash.values()];
}

function shouldReplaceInboxItem(existing: MemoryInboxItem, next: MemoryInboxItem): boolean {
  const existingWeight = inboxStatusWeight(existing.status);
  const nextWeight = inboxStatusWeight(next.status);
  if (existingWeight !== nextWeight) {
    return nextWeight < existingWeight;
  }
  if (existing.mtimeMs !== next.mtimeMs) {
    return next.mtimeMs > existing.mtimeMs;
  }
  return next.filePath.length < existing.filePath.length;
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
    memoryType: normalizeMemoryDocumentType(row.memory_type),
    memoryScope: normalizeMemoryScope(row.memory_scope),
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

function createRecallExcerpt(content: string, query: string, maxChars: number): string {
  const normalized = normalizeWhitespace(stripMarkdownNoise(content));
  if (!normalized) {
    return '';
  }

  const queryTerms = extractRecallTerms(query);
  const lowerContent = normalized.toLowerCase();
  const matchIndex = queryTerms
    .map((term) => lowerContent.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (matchIndex === undefined) {
    return truncateText(normalized, maxChars);
  }

  const start = Math.max(0, matchIndex - Math.floor(maxChars * 0.35));
  const excerpt = normalized.slice(start, start + maxChars);
  return `${start > 0 ? '...' : ''}${truncateText(excerpt, maxChars)}${start + maxChars < normalized.length ? '...' : ''}`;
}

function stripMarkdownNoise(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#~-]+/g, ' ');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
