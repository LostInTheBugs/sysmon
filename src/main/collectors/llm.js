'use strict';
// Détection de serveurs LLM locaux (llama.cpp, Ollama, LM Studio, KoboldCpp)
// Probés une fois, puis rafraîchis toutes les 30s.

const SERVERS = [
  { name: 'llama.cpp', modelsUrl: 'http://127.0.0.1:8080/v1/models', statusUrl: 'http://127.0.0.1:8080/slots', extra: [] },
  { name: 'Ollama', modelsUrl: 'http://127.0.0.1:11434/api/tags', statusUrl: 'http://127.0.0.1:11434/api/ps', extra: [] },
  { name: 'LM Studio', modelsUrl: 'http://127.0.0.1:1234/v1/models', statusUrl: null, extra: [] },
  { name: 'KoboldCpp', modelsUrl: 'http://127.0.0.1:5001/v1/models', statusUrl: null, extra: [] }
];

let last = { detected: false, servers: [], checkedAt: 0 };

async function getJson(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function probe(server) {
  const models = await getJson(server.modelsUrl);
  if (!models) return null;
  const list = models.data && Array.isArray(models.data)
    ? models.data.map(m => ({ id: m.id, sizeBytes: m.size || m.size_vram || null, loaded: false }))
    : (models.models && Array.isArray(models.models)
      ? models.models.map(m => ({ id: m.name, sizeBytes: m.size || m.size_vram || null, loaded: false }))
      : []);
  const status = server.statusUrl ? await getJson(server.statusUrl) : null;
  let running = [];
  let memoryTotal = null;
  if (server.name === 'Ollama' && status && Array.isArray(status.models)) {
    running = status.models.map(m => ({
      id: m.name, memGB: m.size_vram != null ? Math.round(m.size_vram / 1073741824 * 10) / 10 : null, until: m.expires_at || null
    }));
    memoryTotal = running.reduce((a, m) => a + (m.memGB || 0), 0);
  } else if (status && Array.isArray(status)) {
    // llama.cpp /slots → tâches en cours
    running = status
      .filter(s => s.state === 1)
      .map(s => ({ id: (s.model || '').split('/').pop() || 'slot', prompt: (s.prompt || '').slice(0, 40) }));
  }
  return { name: server.name, models: list, running, memoryTotalGB: memoryTotal };
}

async function collect() {
  if (Date.now() - last.checkedAt < 30000) return { ok: true, ...last, cached: true };
  last.checkedAt = Date.now();
  const results = await Promise.all(SERVERS.map(probe));
  const found = results.filter(Boolean);
  last = {
    detected: found.length > 0,
    servers: found.map(f => ({
      name: f.name,
      models: f.models.map(m => ({ ...m, memGB: m.sizeBytes != null ? Math.round(m.sizeBytes / 1073741824 * 10) / 10 : null })),
      running: f.running,
      memoryTotalGB: f.memoryTotalGB
    })),
    checkedAt: Date.now()
  };
  return { ok: true, ...last };
}

module.exports = { collect, name: 'llm' };
