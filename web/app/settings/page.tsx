"use client";

import { useEffect, useState } from "react";
import { loadSettings, saveSettings, exportAllData, importAllData, wipeAllData } from "@/lib/storage";
import type { ExtensionSettings } from "@/lib/storage";
import { buildFullBackup, isFullBackup, restoreFullBackup } from "@/lib/full-backup";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "@/lib/crypto-backup";

export default function SettingsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>({ anthropicKey: "", model: "", autoSyncExtension: true });
  const [importJson, setImportJson] = useState("");
  const [message, setMessage] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [encryptedImport, setEncryptedImport] = useState("");

  /** Item 10: passphrase-encrypted full backup (AES-GCM via crypto-backup). */
  const handleEncryptedExport = async () => {
    if (passphrase.length < 8) {
      setMessage("Use a passphrase of at least 8 characters.");
      return;
    }
    try {
      const backup = await encryptBackup(JSON.stringify(buildFullBackup()), passphrase);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `workdayz-backup-${new Date().toISOString().slice(0, 10)}.encrypted.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("Encrypted backup downloaded. Keep the passphrase — it cannot be recovered.");
    } catch {
      setMessage("Encryption failed — your browser may not support WebCrypto here.");
    }
  };

  const handleEncryptedImport = async () => {
    try {
      const parsed = JSON.parse(encryptedImport);
      if (!isEncryptedBackup(parsed)) {
        setMessage("That isn't an encrypted Workdayz backup.");
        return;
      }
      const plaintext = await decryptBackup(parsed, passphrase);
      const backup = JSON.parse(plaintext);
      if (!isFullBackup(backup)) {
        setMessage("Decrypted, but the contents aren't a Workdayz backup.");
        return;
      }
      const restored = restoreFullBackup(backup);
      setMessage(`Restored ${restored} data item(s). Reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setMessage("Decryption failed — wrong passphrase or corrupted file.");
    }
  };

  const [keyStale, setKeyStale] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    // Item 79: rotation reminder, computed once on mount (render must stay pure).
    setKeyStale(
      Boolean(loaded.anthropicKey && loaded.keySavedAt) &&
        Date.now() - new Date(loaded.keySavedAt!).getTime() > 90 * 86_400_000,
    );
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
        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={settings.persistKey !== false}
            onChange={(e) => setSettings({ ...settings, persistKey: e.target.checked })}
            className="w-4 h-4"
          />
          Remember this key in the browser
          <span className="text-xs text-gray-500">(unchecked = kept only until the browser closes)</span>
        </label>
        {/* Item 79: rotation reminder */}
        {keyStale && (
          <p className="mt-2 text-sm text-amber-400">
            ⚠ This key was saved over 90 days ago — consider rotating it at console.anthropic.com.
          </p>
        )}
      </div>

      {/* Item 80: plain-language privacy statement */}
      <div className="card">
        <h2 className="font-semibold mb-2">🔒 Where your data goes</h2>
        <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
          <li>Your resume, applications, and settings live in <span className="text-gray-300">this browser&apos;s storage</span> — there is no Workdayz server or account.</li>
          <li>Resume + job text is sent to <span className="text-gray-300">Anthropic&apos;s API</span> only when you click Tailor/Import/Draft, using your own key.</li>
          <li>The extension fills forms on <span className="text-gray-300">*.myworkdayjobs.com</span> only, and never submits an application for you.</li>
          <li>Nothing else leaves your machine. Wipe everything anytime below.</li>
        </ul>
      </div>

      {/* Model */}
      <div className="card">
        <h2 className="font-semibold mb-3">Claude Model</h2>
        <select
          aria-label="Claude model" value={settings.model}
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

        {/* Encrypted backup (passphrase-protected, AES-GCM in your browser) */}
        <div className="mt-6 pt-4 border-t border-gray-700">
          <h3 className="font-medium mb-2">🔐 Encrypted backup</h3>
          <p className="text-sm text-gray-400 mb-3">
            Downloads everything (profile, applications, settings) encrypted with a passphrase —
            safe to store in cloud drives. Encryption happens entirely in your browser.
          </p>
          <label>Passphrase (min 8 characters — cannot be recovered if lost)</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Choose a strong passphrase…"
          />
          <div className="flex flex-wrap gap-3 mt-3">
            <button onClick={handleEncryptedExport} disabled={passphrase.length < 8} className="btn btn-secondary">
              ⬇ Download encrypted backup
            </button>
          </div>
          <div className="mt-4">
            <label>Restore from encrypted backup</label>
            <textarea
              value={encryptedImport}
              onChange={(e) => setEncryptedImport(e.target.value)}
              placeholder="Paste the contents of your .encrypted.json backup file…"
              rows={3}
            />
            <button
              onClick={handleEncryptedImport}
              disabled={!encryptedImport.trim() || passphrase.length < 8}
              className="btn btn-secondary mt-2"
            >
              🔓 Decrypt &amp; restore
            </button>
          </div>
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