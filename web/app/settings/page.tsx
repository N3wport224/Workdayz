"use client";

import { useEffect, useState } from "react";
import { loadSettings, saveSettings, exportAllData, importAllData, wipeAllData } from "@/lib/storage";
import type { ExtensionSettings } from "@/lib/storage";

export default function SettingsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>({ anthropicKey: "", model: "", autoSyncExtension: true });
  const [importJson, setImportJson] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const save = () => {
    saveSettings(settings);
    setMessage("Settings saved!");
    setTimeout(() => setMessage(""), 2000);
  };

  const handleExport = () => {
    const data = exportAllData();
    navigator.clipboard.writeText(data).then(() => setMessage("Data copied to clipboard!"));
  };

  const handleImport = () => {
    if (!importJson.trim()) return;
    const result = importAllData(importJson);
    if (result.success) {
      setMessage("Data imported! Reload to see changes.");
      setImportJson("");
    } else {
      setMessage(`Import failed: ${result.error}`);
    }
  };

  const handleWipe = () => {
    if (confirm("Are you sure? This will delete ALL your data — profile, applications, and settings.")) {
      if (confirm("Really? This cannot be undone.")) {
        wipeAllData();
        setMessage("All data wiped. Reloading...");
        setTimeout(() => window.location.reload(), 1000);
      }
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">⚙️ Settings</h1>

      {/* API Key */}
      <div className="card">
        <h2 className="font-semibold mb-4">Anthropic API Key</h2>
        <p className="text-sm text-gray-400 mb-3">
          Required for Claude-powered tailoring. You can also set <code className="text-blue-400">ANTHROPIC_API_KEY</code> in your .env.local file.
        </p>
        <input
          type="password"
          value={settings.anthropicKey}
          onChange={(e) => setSettings({ ...settings, anthropicKey: e.target.value })}
          placeholder="sk-ant-..."
        />
      </div>

      {/* Model */}
      <div className="card">
        <h2 className="font-semibold mb-3">Claude Model</h2>
        <select
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        >
          <option value="">Server default</option>
          <option value="claude-sonnet-5">Claude Sonnet 5 (Best balance)</option>
          <option value="claude-haiku-4-5">Claude Haiku 4.5 (Faster, cheaper)</option>
          <option value="claude-opus-4-8">Claude Opus 4.8 (Best quality, most expensive)</option>
        </select>
      </div>

      {/* Auto-sync */}
      <div className="card">
        <h2 className="font-semibold mb-3">Extension Sync</h2>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoSyncExtension}
            onChange={(e) => setSettings({ ...settings, autoSyncExtension: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-sm">Auto-sync profile to extension when saved</span>
        </label>
      </div>

      <button onClick={save} className="btn btn-primary">
        {message || "Save settings"}
      </button>

      {/* Data management */}
      <div className="card">
        <h2 className="font-semibold mb-4">Data Management</h2>
        <div className="flex flex-wrap gap-3 mb-4">
          <button onClick={handleExport} className="btn btn-secondary">📋 Export all data</button>
          <button onClick={handleWipe} className="btn btn-danger">🗑️ Wipe all data</button>
        </div>
        <div>
          <label>Import data from JSON</label>
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='Paste your exported JSON here...'
            rows={4}
          />
          <button onClick={handleImport} disabled={!importJson.trim()} className="btn btn-secondary mt-2">
            Import
          </button>
        </div>
      </div>

      {/* Extension info */}
      <div className="card">
        <h2 className="font-semibold mb-3">Connection</h2>
        <p className="text-sm text-gray-400">
          The web app communicates with the browser extension via <code className="text-blue-400">window.postMessage</code>.
          Install the extension from the <code className="text-blue-400">extension/dist</code> directory as an unpacked extension.
          Then connect it from the extension popup by entering this URL.
        </p>
        <div className="mt-3 p-3 bg-gray-800 rounded-lg text-sm">
          <span className="text-gray-400">Web app origin:</span>
          <span className="ml-2 text-blue-400">{typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}</span>
        </div>
      </div>

      {message && (
        <div className="card border-green-500/30 bg-green-950/30">
          <p className="text-green-400">{message}</p>
        </div>
      )}
    </div>
  );
}