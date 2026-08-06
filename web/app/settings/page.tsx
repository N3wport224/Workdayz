"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadSettings,
  saveSettings,
  exportAllData,
  importAllData,
  wipeAllData,
  recordBackupDownload,
  loadLastBackupDownload,
  loadApplications,
  listProfileNames,
} from "@/lib/storage";
import type { ExtensionSettings } from "@/lib/storage";
import { buildFullBackup, isFullBackup, restoreFullBackup } from "@/lib/full-backup";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "@/lib/crypto-backup";
import { backupFilename, backupNudge, type BackupNudge } from "@/lib/backup-schedule";
import {
  getBridgeStatus,
  onBackupSnapshotPayload,
  onBackupSnapshotStored,
  onBackupStatus,
  requestBackupSnapshot,
  requestBackupStatus,
  sendBackupSnapshot,
  type ExtensionBackupStatus,
} from "@/lib/extension-bridge";
import { summarizeCosts, type CostSummary } from "@/lib/cost-log";

export default function SettingsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>({ anthropicKey: "", model: "", autoSyncExtension: true });
  const [importJson, setImportJson] = useState("");
  const [message, setMessage] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [encryptedImport, setEncryptedImport] = useState("");

  // The bridge listeners are registered in a mount-only effect, so a closure
  // over `passphrase` would be frozen at "" forever and every restore would
  // fail to decrypt. A ref stays current without re-subscribing on each keystroke.
  const passphraseRef = useRef(passphrase);
  useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);

  // Backup scheduling state
  const [nudge, setNudge] = useState<BackupNudge | null>(null);
  const [extBackup, setExtBackup] = useState<ExtensionBackupStatus | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  /** Recomputes the nudge from current data. Called on mount and after any
   * action that changes a backup clock, so the banner never lies. */
  const refreshNudge = (lastSnapshotAt?: string | null) => {
    setNudge(
      backupNudge({
        lastDownloadAt: loadLastBackupDownload(),
        lastSnapshotAt: lastSnapshotAt ?? extBackup?.lastSnapshotAt ?? null,
        applicationCount: loadApplications().length,
        profileCount: listProfileNames().length,
      }),
    );
  };

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
      a.download = backupFilename(new Date(), true);
      a.click();
      URL.revokeObjectURL(a.href);
      // Only a real file on disk resets the download clock.
      recordBackupDownload();
      refreshNudge();
      setMessage("Encrypted backup downloaded. Keep the passphrase — it cannot be recovered.");
    } catch {
      setMessage("Encryption failed — your browser may not support WebCrypto here.");
    }
  };

  /**
   * Pushes an encrypted snapshot to the extension. Encryption happens HERE,
   * because this is where the user is present to supply a passphrase — the
   * extension never holds one. Storing it beside the ciphertext would mean the
   * encryption protected nothing.
   */
  const handlePushSnapshot = async () => {
    if (getBridgeStatus() !== "detected") {
      setMessage("Extension not detected — connect it from the extension popup first.");
      return;
    }
    if (passphrase.length < 8) {
      setMessage("Enter a passphrase (8+ characters) above — the snapshot is encrypted before it leaves this page.");
      return;
    }
    try {
      const plain = buildFullBackup();
      const encrypted = await encryptBackup(JSON.stringify(plain), passphrase);
      sendBackupSnapshot({
        version: 1,
        createdAt: new Date().toISOString(),
        encrypted: true,
        payload: JSON.stringify(encrypted),
        applications: loadApplications().length,
        profiles: listProfileNames().length,
      });
      setMessage("Encrypted snapshot sent to the extension…");
    } catch {
      setMessage("Couldn't build the snapshot — your browser may not support WebCrypto here.");
    }
  };

  /** Pulls a stored snapshot back and restores it. Needs the same passphrase. */
  const handleRestoreFromExtension = (createdAt?: string) => {
    if (getBridgeStatus() !== "detected") {
      setMessage("Extension not detected — connect it from the extension popup first.");
      return;
    }
    if (passphrase.length < 8) {
      setMessage("Enter the passphrase you used for that snapshot.");
      return;
    }
    setMessage("Fetching the snapshot from the extension…");
    requestBackupSnapshot(createdAt);
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
  // Item 96: local API-spend estimate
  const [costs, setCosts] = useState<CostSummary | null>(null);
  // window.location.origin differs between the server-rendered placeholder
  // and the client, so it's read post-mount to avoid a hydration mismatch.
  const [webAppOrigin, setWebAppOrigin] = useState("http://localhost:3000");

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setCosts(summarizeCosts());
    setWebAppOrigin(window.location.origin);
    // Item 79: rotation reminder, computed once on mount (render must stay pure).
    setKeyStale(
      Boolean(loaded.anthropicKey && loaded.keySavedAt) &&
        Date.now() - new Date(loaded.keySavedAt!).getTime() > 90 * 86_400_000,
    );

    // Backup nudge. Computed from localStorage first so the banner shows even
    // with no extension installed, then refined once the extension reports.
    setNudge(
      backupNudge({
        lastDownloadAt: loadLastBackupDownload(),
        lastSnapshotAt: null,
        applicationCount: loadApplications().length,
        profileCount: listProfileNames().length,
      }),
    );

    const offStatus = onBackupStatus((status) => {
      setExtBackup(status);
      setNudge(
        backupNudge({
          lastDownloadAt: loadLastBackupDownload(),
          lastSnapshotAt: status?.lastSnapshotAt ?? null,
          applicationCount: loadApplications().length,
          profileCount: listProfileNames().length,
          intervalDays: status?.intervalDays,
        }),
      );
    });

    const offStored = onBackupSnapshotStored((result) => {
      if (result?.ok) {
        setMessage(`Snapshot stored in the extension (${result.kept} kept, ${Math.round((result.bytes ?? 0) / 1024)} KB).`);
        requestBackupStatus();
      } else if (result?.reason === "too-large") {
        setMessage(
          `Snapshot too large for extension storage (${Math.round((result.bytes ?? 0) / 1024)} KB). Download a file backup instead.`,
        );
      } else {
        setMessage("The extension refused the snapshot — nothing was stored.");
      }
    });

    // Restore path: the payload comes back encrypted and is decrypted here.
    const offPayload = onBackupSnapshotPayload(async (snapshot) => {
      if (!snapshot) {
        setMessage("The extension has no stored snapshot yet.");
        return;
      }
      try {
        const parsed = JSON.parse(snapshot.payload);
        const plaintext = snapshot.encrypted && isEncryptedBackup(parsed)
          ? await decryptBackup(parsed, passphraseRef.current)
          : snapshot.payload;
        const backup = JSON.parse(plaintext);
        if (!isFullBackup(backup)) {
          setMessage("That snapshot didn't contain a Workdayz backup.");
          return;
        }
        const restored = restoreFullBackup(backup);
        setMessage(`Restored ${restored} data item(s) from the extension snapshot. Reloading…`);
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        setMessage("Couldn't decrypt that snapshot — wrong passphrase, or it was stored with a different one.");
      }
    });

    const askExtension = setTimeout(requestBackupStatus, 800); // let the bridge attach
    return () => {
      offStatus();
      offStored();
      offPayload();
      clearTimeout(askExtension);
    };
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

      {/* Backup nudge. Dismissible, and silent when the tracker is empty or a
          recent download exists — a banner that always shows gets ignored. */}
      {nudge && nudge.level !== "none" && !nudgeDismissed && (
        <div
          role="status"
          className={`card border ${
            nudge.level === "overdue" ? "border-amber-500/60 bg-amber-500/5" : "border-gray-600"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold mb-1">
                {nudge.level === "overdue" ? "⚠️ Back up your job search" : "💾 Backup reminder"}
              </h2>
              <p className="text-sm text-gray-300">{nudge.message}</p>
              <p className="text-sm text-gray-400 mt-2">
                Set a passphrase below, then download — it takes one click and the file works on any machine.
              </p>
            </div>
            <button
              onClick={() => setNudgeDismissed(true)}
              className="btn btn-secondary btn-sm shrink-0"
              aria-label="Dismiss the backup reminder"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
          <span className="text-xs text-gray-400">(unchecked = kept only until the browser closes)</span>
        </label>
        {/* Item 79: rotation reminder */}
        {keyStale && (
          <p className="mt-2 text-sm text-amber-400">
            ⚠ This key was saved over 90 days ago — consider rotating it at console.anthropic.com.
          </p>
        )}
      </div>

      {/* Item 96: API spend dashboard (local estimates) */}
      {costs && costs.runs > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-2">💸 API spend (estimated)</h2>
          <div className="grid grid-cols-2 gap-4 text-center text-sm">
            <div>
              <div className="text-2xl font-bold">${costs.thisMonthUsd.toFixed(2)}</div>
              <div className="text-gray-500 text-xs uppercase">This month ({costs.thisMonthRuns} run{costs.thisMonthRuns === 1 ? "" : "s"})</div>
            </div>
            <div>
              <div className="text-2xl font-bold">${costs.totalUsd.toFixed(2)}</div>
              <div className="text-gray-500 text-xs uppercase">All time ({costs.runs} runs)</div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Estimates from per-run token counts and published rates — check console.anthropic.com for actual billing.</p>
        </div>
      )}

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

        {/* Extension-held snapshots: a second copy outside localStorage */}
        <div className="mt-6 pt-4 border-t border-gray-700">
          <h3 className="font-medium mb-2">🗄 Snapshot in the extension</h3>
          <p className="text-sm text-gray-400 mb-3">
            Stores an encrypted copy in the extension. The extension&apos;s storage is separate
            from this page&apos;s, so a snapshot survives your browser data being cleared — but not
            the browser itself being removed, which is what the file download above is for.
            Encryption happens here, using the passphrase above; the extension never receives it.
          </p>
          {extBackup ? (
            <p className="text-sm text-gray-400 mb-3">
              {extBackup.snapshotCount === 0
                ? "No snapshot stored yet."
                : `${extBackup.snapshotCount} snapshot(s) held, newest ${
                    extBackup.ageDays === null ? "unknown" : `${extBackup.ageDays} day(s) old`
                  }. Reminder cadence: every ${extBackup.intervalDays} day(s).`}
            </p>
          ) : (
            <p className="text-sm text-gray-500 mb-3">Extension not connected — snapshots unavailable.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button onClick={handlePushSnapshot} disabled={passphrase.length < 8} className="btn btn-secondary">
              ⬆ Send encrypted snapshot
            </button>
            <button
              onClick={() => handleRestoreFromExtension()}
              disabled={passphrase.length < 8 || !extBackup?.snapshotCount}
              className="btn btn-secondary"
            >
              ⬇ Restore newest snapshot
            </button>
          </div>
          {extBackup && extBackup.snapshots.length > 1 && (
            <div className="mt-3">
              <label className="text-gray-400">Or restore an older one</label>
              <div className="flex flex-col gap-1 mt-1">
                {[...extBackup.snapshots].reverse().slice(1).map((s) => (
                  <button
                    key={s.createdAt}
                    onClick={() => handleRestoreFromExtension(s.createdAt)}
                    disabled={passphrase.length < 8}
                    className="btn btn-secondary btn-sm text-left"
                  >
                    {new Date(s.createdAt).toLocaleString()} — {s.applications} application(s),{" "}
                    {s.profiles} profile(s){s.encrypted ? "" : " (unencrypted)"}
                  </button>
                ))}
              </div>
            </div>
          )}
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
          <span className="ml-2 text-blue-400">{webAppOrigin}</span>
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