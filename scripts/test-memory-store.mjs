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
  const fileC = path.join(sourceB, 'financial-fenced.md');
  await fs.writeFile(fileA, financialMarkdown, 'utf8');
  await fs.writeFile(fileB, financialMarkdown, 'utf8');
  await fs.writeFile(fileC, `\`\`\`markdown\n${financialMarkdown}\n\`\`\``, 'utf8');

  const store = new MemoryStore(dbPath);
  try {
    store.addImportSource(sourceA);
    store.addImportSource(sourceB);

    const initialInbox = await store.scanInbox();
    const financialItems = initialInbox.filter((item) => item.title === '普通散户股票投资准则');
    assert(financialItems.length === 1, `Expected duplicate Markdown files to collapse to one inbox item, got ${financialItems.length}.`);
    assert(financialItems[0].status === 'new', `Expected first inbox item to be new, got ${financialItems[0].status}.`);

    const inboxDocument = await store.getInboxDocument(financialItems[0].filePath);
    const fencedInboxDocument = await store.getInboxDocument(fileC);
    assert(fencedInboxDocument.contentMarkdown === financialMarkdown, 'Expected markdown code-fence wrapper to be stripped during preview.');
    const duplicatedTitle = [
      '# 重复标题测试',
      '',
      '# 重复标题测试',
      '',
      '正文',
    ].join('\n');
    const duplicatedTitleFile = path.join(sourceA, 'duplicated-title.md');
    await fs.writeFile(duplicatedTitleFile, duplicatedTitle, 'utf8');
    const duplicatedTitleDocument = await store.getInboxDocument(duplicatedTitleFile);
    assert(duplicatedTitleDocument.contentMarkdown === '# 重复标题测试\n\n正文', 'Expected consecutive duplicate top-level titles to be normalized.');
    const imported = await store.importDocument({
      sourceId: inboxDocument.item.sourceId,
      sourcePath: inboxDocument.item.sourcePath,
      filePath: inboxDocument.item.filePath,
      title: inboxDocument.suggestedTitle,
      contentMarkdown: inboxDocument.contentMarkdown,
    });

    const stockResults = store.searchDocuments('股票');
    assert(stockResults.some((result) => result.id === imported.id), 'Expected Chinese substring search for "股票" to find imported memory.');

    const touchedAt = new Date(Date.now() + 60_000);
    await fs.utimes(inboxDocument.item.filePath, touchedAt, touchedAt);
    const touchedInbox = await store.scanInbox();
    const touchedItem = touchedInbox.find((item) => item.filePath === inboxDocument.item.filePath);
    assert(touchedItem?.status === 'imported', `Expected unchanged content with newer mtime to stay imported, got ${touchedItem?.status ?? 'missing'}.`);

    const modifiedMarkdown = `${financialMarkdown}\n\n新增一条真实内容变化。`;
    await fs.writeFile(inboxDocument.item.filePath, modifiedMarkdown, 'utf8');
    const modifiedInbox = await store.scanInbox();
    const modifiedItem = modifiedInbox.find((item) => item.filePath === inboxDocument.item.filePath);
    assert(modifiedItem?.status === 'modified', `Expected changed content hash to be modified, got ${modifiedItem?.status ?? 'missing'}.`);

    await fs.writeFile(inboxDocument.item.filePath, financialMarkdown, 'utf8');
    await store.scanInbox();

    const recall = store.recallForAgentTask('这只股票最近下跌很多，可以抄底买入吗？');
    assert(recall.items.some((item) => item.id === imported.id), 'Expected stock-related agent task to recall imported memory.');
    assert(recall.agentContext.includes('用户长期记忆'), 'Expected agent context to include the memory header.');
    assert(recall.agentContext.includes('优先保护本金'), 'Expected agent context to include relevant memory content.');

    store.disableDocument(imported.id);
    assert(!store.searchDocuments('股票').some((result) => result.id === imported.id), 'Expected disabled memory to be excluded from search.');
    assert(!store.recallForAgentTask('这只股票可以买吗？').items.some((item) => item.id === imported.id), 'Expected disabled memory to be excluded from agent recall.');

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
    assert(store.recallForAgentTask('这只股票可以买吗？').items.some((item) => item.id === restored.id), 'Expected restored memory to return to agent recall.');

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
