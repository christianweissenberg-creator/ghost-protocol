"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Passwort im Body per POST — nicht in der URL (kein Log-/History-Leak).
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      if (res.status === 429) {
        setError("Zu viele Fehlversuche. Bitte einige Minuten warten.");
      } else {
        setError("Falsches Passwort");
      }
    } catch {
      setError("Verbindungsfehler. Bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="card-ghost p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-semibold font-[family-name:var(--font-cormorant)]"
              style={{ background: "rgba(201, 168, 106, 0.10)", color: "var(--gp-gold)", border: "1px solid rgba(201,168,106,0.25)" }}>
              G
            </div>
            <h1 className="font-[family-name:var(--font-cormorant)] font-semibold text-2xl tracking-tight">
              Ghost <em style={{ fontStyle: "italic", color: "var(--gp-gold)" }}>Protocol</em>
            </h1>
            <p className="text-text-muted text-xs mt-1">Command Center Access</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Zugangspasswort"
                autoFocus
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-lg text-sm bg-[#1a1a22] border border-[#222230] text-white placeholder-[#555] focus:outline-none focus:border-[#8b5cf6] transition-colors"
              />
            </div>
            {error && (
              <p className="text-xs text-[#ff3366]">{error}</p>
            )}
            <button
              type="submit"
              disabled={!password || loading}
              className="w-full px-4 py-3 rounded-lg text-sm font-medium bg-[#8b5cf6] text-white hover:bg-[#7c4fe0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Prüfe …" : "Einloggen"}
            </button>
          </form>

          <p className="text-[10px] text-text-muted text-center mt-6">
            Autonomous AI Corporation
          </p>
        </div>
      </div>
    </div>
  );
}
