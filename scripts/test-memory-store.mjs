import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MemoryStore } = require('../dist/main/memoryStore.js');

const rootDir = path.join(process.cwd(), 'tmp', 'memory-store-test');
const sourceA = path.join(rootDir, 'source-a');
const sourceB = path.join(rootDir, 'source-b');
const dbPath = path.join(rootDir, 'memory.sqlite');

const financialMarkdown = [
  '# 普通散户股票投资准则',
  '',
  '股票投资应优先保护本金，避免杠杆，控制单只股票仓位。',
  '这份文档用于验证中文短词搜索和长期记忆恢复。',
].join('\n');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(sourceA, { recursive: true });
  await fs.mkdir(sourceB, { recursive: true });

  const fileA = path.join(sourceA, 'financial.md');
  const fileB = path.join(sourceB, 'financial-copy.md');
  await fs.writeFile(fileA, financialMarkdown, 'utf8');
  await fs.writeFile(fileB, financialMarkdown, 'utf8');

  const store = new MemoryStore(dbPath);
  try {
    store.addImportSource(sourceA);
    store.addImportSource(sourceB);

    const initialInbox = await store.scanInbox();
    const financialItems = initialInbox.filter((item) => item.title === '普通散户股票投资准则');
    assert(financialItems.length === 1, `Expected duplicate Markdown files to collapse to one inbox item, got ${financialItems.length}.`);
    assert(financialItems[0].status === 'new', `Expected first inbox item to be new, got ${financialItems[0].status}.`);

    const inboxDocument = await store.getInboxDocument(financialItems[0].filePath);
    const imported = await store.importDocument({
      sourceId: inboxDocument.item.sourceId,
      sourcePath: inboxDocument.item.sourcePath,
      filePath: inboxDocument.item.filePath,
      title: inboxDocument.suggestedTitle,
      contentMarkdown: inboxDocument.contentMarkdown,
    });

    const stockResults = store.searchDocuments('股票');
    assert(stockResults.some((result) => result.id === imported.id), 'Expected Chinese substring search for "股票" to find imported memory.');

    store.disableDocument(imported.id);
    assert(!store.searchDocuments('股票').some((result) => result.id === imported.id), 'Expected disabled memory to be excluded from search.');

    const disabledInbox = await store.scanInbox();
    const disabledItem = disabledInbox.find((item) => item.hash === inboxDocument.item.hash);
    assert(disabledItem?.status === 'disabled', `Expected disabled source to reappear as disabled, got ${disabledItem?.status ?? 'missing'}.`);

    const disabledDocument = await store.getInboxDocument(disabledItem.filePath);
    const restored = await store.importDocument({
      sourceId: disabledDocument.item.sourceId,
      sourcePath: disabledDocument.item.sourcePath,
      filePath: disabledDocument.item.filePath,
      title: disabledDocument.suggestedTitle,
      contentMarkdown: disabledDocument.contentMarkdown,
    });
    assert(restored.id === imported.id, 'Expected restoring disabled memory to reuse the original record.');
    assert(store.searchDocuments('股票').some((result) => result.id === restored.id), 'Expected restored memory to return to search results.');

    assert(restored.sourcePath, 'Expected restored memory to keep a source path.');
    await fs.rm(restored.sourcePath);
    await store.scanInbox();
    const missingSourceDocument = store.getDocument(restored.id);
    assert(missingSourceDocument?.sourceExists === false, 'Expected sourceExists=false after deleting the source file.');

    await fs.writeFile(restored.sourcePath, financialMarkdown, 'utf8');
    await store.scanInbox();
    const recoveredSourceDocument = store.getDocument(restored.id);
    assert(recoveredSourceDocument?.sourceExists === true, 'Expected sourceExists=true after restoring the source file.');
  } finally {
    store.close();
  }

  console.log('MemoryStore workflow test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
