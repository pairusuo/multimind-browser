import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PRESET_SITES,
  findPresetSiteByUrl,
  inferModeFromUrl,
} = require('../dist/shared/presetSites.js');
const {
  getRiskySiteReasonKey,
} = require('../dist/shared/riskySites.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPresetSite(rawUrl, expectedId, expectedMode) {
  const site = findPresetSiteByUrl(rawUrl);
  assert(site?.id === expectedId, `Expected ${rawUrl} to match ${expectedId}, got ${site?.id ?? 'null'}.`);
  assert(inferModeFromUrl(rawUrl) === expectedMode, `Expected ${rawUrl} to infer ${expectedMode}.`);
}

function main() {
  const ids = PRESET_SITES.map((site) => site.id);
  assert(new Set(ids).size === ids.length, 'Expected preset site ids to be unique.');

  for (const site of PRESET_SITES) {
    assert(site.url.startsWith('https://'), `Expected preset site ${site.id} to use https URL.`);
    assert(site.mode === 'chat' || site.mode === 'search', `Expected preset site ${site.id} to have a valid mode.`);
    if (site.mode === 'search') {
      assert(site.searchUrlTemplate?.includes('{query}'), `Expected search site ${site.id} to include a query template.`);
    }
  }

  assertPresetSite('chatgpt.com', 'chatgpt', 'chat');
  assertPresetSite('https://chatgpt.com/c/example', 'chatgpt', 'chat');
  assertPresetSite('https://www.doubao.com/chat/', 'doubao', 'chat');
  assertPresetSite('https://chat.deepseek.com/a/chat/s/example', 'deepseek', 'chat');
  assertPresetSite('https://kimi.moonshot.cn/chat/example', 'kimi', 'chat');
  assertPresetSite('https://chat.qwen.ai/c/example', 'tongyi', 'chat');
  assertPresetSite('https://www.google.com/search?q=test', 'google', 'search');
  assertPresetSite('https://news.google.com', 'google', 'search');
  assertPresetSite('https://www.baidu.com/s?wd=test', 'baidu', 'search');

  assert(inferModeFromUrl('not a url at all') === 'unknown', 'Expected invalid URL text to infer unknown mode.');
  assert(findPresetSiteByUrl('https://example.com') === null, 'Expected unknown host to have no preset site.');

  assert(getRiskySiteReasonKey('gemini') === 'riskySites.geminiGoogleLogin', 'Expected gemini shorthand to be flagged.');
  assert(getRiskySiteReasonKey('https://gemini.google.com/app') === 'riskySites.geminiGoogleLogin', 'Expected Gemini URL to be flagged.');
  assert(getRiskySiteReasonKey('https://chatgpt.com') === null, 'Expected normal AI site to avoid risky-site warning.');

  console.log('Shared logic test passed.');
}

main();
