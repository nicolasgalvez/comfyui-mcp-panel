import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual nested discovery/reconnect functions without mounting the
// canvas. These dependencies are the same API and client boundaries as the UI.
const source = readFileSync(new URL('../../web/js/comfyui-mcp-panel.js', import.meta.url), 'utf8');
const discovery = source.slice(source.indexOf('  async function fetchAdvertisedBridgeUrl()'), source.indexOf('  async function connectAgent('));
function panel({ protocol = 'http:', advertised = 'wss://agent.example/?token=test', wanted = 'ws://127.0.0.1:9180' } = {}) {
  const calls = [];
  const context = {
    location: { protocol },
    api: { fetchApi: async path => { calls.push(path); return { json: async () => ({ url: advertised }) }; } },
    urlInput: { value: wanted }, selectedBackend: 'ollama', lastAutoUrl: '',
    defaultBridgeUrlFor: () => 'ws://127.0.0.1:9180',
    client: { currentUrl: () => 'ws://127.0.0.1:9180', setUrl: (url, options) => calls.push({ url, persist: options.persist }) },
  };
  return { calls, ...runInNewContext(`${discovery}; ({ fetchAdvertisedBridgeUrl, reclaimAdvertisedBridgeUrl })`, context) };
}
for (const protocol of ['http:', 'https:']) {
  test(`discovers advertised secure bridge from ${protocol} UI`, async () => {
    const p = panel({ protocol });
    assert.equal(await p.fetchAdvertisedBridgeUrl(), 'wss://agent.example/?token=test');
  });
  test(`reclaims bridge after startup race from ${protocol} UI`, async () => {
    const p = panel({ protocol });
    await p.reclaimAdvertisedBridgeUrl();
    assert.deepEqual(p.calls, ['/comfyui_mcp_panel/bridge_url', { url: 'wss://agent.example/?token=test', persist: false }]);
  });
}
test('preserves an explicitly configured bridge', async () => {
  const p = panel({ wanted: 'wss://custom.example/' });
  await p.reclaimAdvertisedBridgeUrl();
  assert.deepEqual(p.calls, []);
});
test('rejects an insecure advertised bridge', async () => {
  assert.equal(await panel({ advertised: 'ws://remote.example/' }).fetchAdvertisedBridgeUrl(), null);
});

test('a fresh browser uses the configured backend instead of overwriting it with Claude', () => {
  const start = source.indexOf('  let selectedBackend = (() => {');
  const initializer = source.slice(start, source.indexOf('  // The backend we\'re actually CONNECTED', start));
  const selected = runInNewContext(`${initializer}; selectedBackend`, {
    window: { localStorage: { getItem: () => null } },
    STORAGE_KEY_BACKEND: 'runtime', SETTING_BACKEND: 'default', getSetting: () => 'ollama',
  });
  assert.equal(selected, 'ollama');
});

test('remote Ollama is not replaced by a signed-in provider when local CLI readiness is false', () => {
  const start = source.indexOf('  function applyReadiness(data, opts)');
  const apply = source.slice(start, source.indexOf('  // "Set up the other provider"', start));
  const notes = [];
  const context = {
    selectedBackend: 'ollama', readinessFromOrchestrator: false, backendReady: {},
    onboard: {}, anyReady: false, lastStatus: 'connecting', autoPickDone: false,
    externalOrchestratorMode: () => true, backendEnabled: () => true,
    BACKEND_LABELS: { ollama: 'Ollama', claude: 'Claude' },
    renderBackendChips: () => {}, setAskPlaceholder: () => {}, appendSystem: message => notes.push(message),
    data: { backends: [{ backend: 'ollama', ready: false, cli: false }, { backend: 'claude', ready: true }] },
  };
  assert.equal(runInNewContext(`${apply}; applyReadiness(data, { fromOrchestrator: true }); selectedBackend`, context), 'ollama');
  assert.deepEqual(notes, []);
});
