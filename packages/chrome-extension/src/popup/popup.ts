/**
 * Popup Script: Interactive UI controller for the Harpy Chrome Extension
 */

import { FirebaseTokenData, HarpyContext, WsConnectionStatus } from "../types";

class HarpyPopupController {
  private activeTab: chrome.tabs.Tab | null = null;
  private currentWsStatus: WsConnectionStatus = "disconnected";
  private tokenData: FirebaseTokenData | null = null;
  private harpyContext: HarpyContext | null = null;
  private isHarpyTab = false;

  // DOM Elements
  private overallStatusBadge = document.getElementById("overallStatusBadge")!;
  private wsDot = document.getElementById("wsDot")!;
  private wsStatusBadge = document.getElementById("wsStatusBadge")!;
  private wsUrlText = document.getElementById("wsUrlText")!;
  private authStatusBadge = document.getElementById("authStatusBadge")!;
  private userEmailText = document.getElementById("userEmailText")!;
  private userUidText = document.getElementById("userUidText")!;
  private tokenExpiryText = document.getElementById("tokenExpiryText")!;
  private btnCopyToken = document.getElementById("btnCopyToken") as HTMLButtonElement;
  private btnRefreshToken = document.getElementById("btnRefreshToken") as HTMLButtonElement;
  private btnReconnectWs = document.getElementById("btnReconnectWs") as HTMLButtonElement;
  private btnPingWs = document.getElementById("btnPingWs") as HTMLButtonElement;
  private pageTypeBadge = document.getElementById("pageTypeBadge")!;
  private entityIdText = document.getElementById("entityIdText")!;
  private worldIdText = document.getElementById("worldIdText")!;
  private angularStatusText = document.getElementById("angularStatusText")!;
  private btnTestDom = document.getElementById("btnTestDom") as HTMLButtonElement;
  private btnClearLogs = document.getElementById("btnClearLogs") as HTMLButtonElement;
  private logsContainer = document.getElementById("logsContainer")!;
  private toast = document.getElementById("toast")!;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    this.bindEvents();
    try {
      await chrome.runtime.sendMessage({ type: "RECONNECT_WS" });
    } catch (e) {
      // Background worker starting up
    }
    await this.detectActiveTab();
    await this.refreshState();

    // Periodic state refresh
    setInterval(() => this.updateExpirationCountdown(), 1000);
  }

  private bindEvents(): void {
    this.btnReconnectWs.addEventListener("click", () => this.handleReconnectWs());
    this.btnPingWs.addEventListener("click", () => this.handlePingWs());
    this.btnCopyToken.addEventListener("click", () => this.handleCopyToken());
    this.btnRefreshToken.addEventListener("click", () => this.handleRefreshToken());
    this.btnTestDom.addEventListener("click", () => this.handleTestDom());
    this.btnClearLogs.addEventListener("click", () => this.clearLogs());

    // Listen for background / content status updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "STATUS_UPDATE" && message.payload) {
        this.applyStateUpdate(message.payload);
      }
    });
  }

  private async detectActiveTab(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.activeTab = tab || null;

      if (tab && tab.url) {
        this.isHarpyTab = tab.url.includes("harpy.gg");
        if (this.isHarpyTab) {
          this.pageTypeBadge.textContent = "Harpy.gg Actif";
          this.pageTypeBadge.className = "badge badge-success";
          this.log(`Onglet actif: ${tab.url}`, "info");
        } else {
          this.pageTypeBadge.textContent = "Hors Harpy.gg";
          this.pageTypeBadge.className = "badge badge-neutral";
          this.log("L'onglet actif n'est pas sur Harpy.gg", "warn");
        }
      }
    } catch (err: any) {
      this.log(`Erreur détection onglet: ${err.message}`, "error");
    }
  }

  private async refreshState(): Promise<void> {
    if (!this.activeTab || !this.activeTab.id || !this.isHarpyTab) {
      this.updateWsUi("disconnected", "ws://127.0.0.1:18765");
      this.updateOverallStatus("Inactif", "badge-neutral");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(this.activeTab.id, { type: "GET_STATUS" });
      if (response) {
        this.applyStateUpdate(response);
      }
    } catch (err: any) {
      this.log("Content script non joignable sur l'onglet actif", "warn");
      this.angularStatusText.textContent = "Non disponible";
    }
  }

  private applyStateUpdate(state: any): void {
    if (state.wsStatus) {
      this.currentWsStatus = state.wsStatus;
      this.updateWsUi(state.wsStatus, state.wsUrl || "ws://127.0.0.1:18765");
    }

    if (state.tokenData) {
      this.tokenData = state.tokenData;
      this.updateAuthUi(state.tokenData);
    } else {
      this.authStatusBadge.textContent = "Non authentifié";
      this.authStatusBadge.className = "badge badge-danger";
      this.btnCopyToken.disabled = true;
    }

    if (state.harpyContext) {
      this.harpyContext = state.harpyContext;
      this.updateContextUi(state.harpyContext);
    }

    this.computeOverallStatus();
  }

  private updateWsUi(status: WsConnectionStatus, url: string): void {
    this.wsUrlText.textContent = url;
    switch (status) {
      case "connected":
        this.wsDot.className = "dot dot-connected";
        this.wsStatusBadge.textContent = "Connecté";
        this.wsStatusBadge.className = "badge badge-success";
        break;
      case "connecting":
      case "reconnecting":
        this.wsDot.className = "dot dot-connecting";
        this.wsStatusBadge.textContent = "Connexion...";
        this.wsStatusBadge.className = "badge badge-warning";
        break;
      case "disconnected":
      default:
        this.wsDot.className = "dot dot-disconnected";
        this.wsStatusBadge.textContent = "Déconnecté";
        this.wsStatusBadge.className = "badge badge-danger";
        break;
    }
  }

  private updateAuthUi(token: FirebaseTokenData): void {
    this.userEmailText.textContent = token.email || token.displayName || "Connecté";
    this.userUidText.textContent = token.uid || "Inconnu";
    this.btnCopyToken.disabled = false;

    this.authStatusBadge.textContent = "Valide";
    this.authStatusBadge.className = "badge badge-success";

    this.updateExpirationCountdown();
  }

  private updateContextUi(ctx: HarpyContext): void {
    this.entityIdText.textContent = ctx.entityId || "Aucune";
    this.worldIdText.textContent = ctx.worldId || ctx.campaignId || "-";
    this.angularStatusText.textContent = "Bridge Connecté";
  }

  private updateExpirationCountdown(): void {
    if (!this.tokenData || !this.tokenData.expirationTime) {
      this.tokenExpiryText.textContent = "-";
      return;
    }

    const remainingMs = this.tokenData.expirationTime - Date.now();
    if (remainingMs <= 0) {
      this.tokenExpiryText.textContent = "Expiré";
      this.tokenExpiryText.style.color = "var(--accent-red)";
      this.authStatusBadge.textContent = "Expiré";
      this.authStatusBadge.className = "badge badge-danger";
    } else {
      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      this.tokenExpiryText.textContent = `${minutes}m ${seconds}s`;
      this.tokenExpiryText.style.color = minutes < 5 ? "var(--accent-amber)" : "var(--text-primary)";
    }
  }

  private computeOverallStatus(): void {
    if (!this.isHarpyTab) {
      this.updateOverallStatus("Hors Harpy", "badge-neutral");
    } else if (this.currentWsStatus === "connected" && this.tokenData) {
      this.updateOverallStatus("Opérationnel", "badge-success");
    } else if (this.currentWsStatus === "connected") {
      this.updateOverallStatus("WS Seul", "badge-warning");
    } else if (this.tokenData) {
      this.updateOverallStatus("Jeton Seul", "badge-warning");
    } else {
      this.updateOverallStatus("Déconnecté", "badge-danger");
    }
  }

  private updateOverallStatus(text: string, badgeClass: string): void {
    this.overallStatusBadge.textContent = text;
    this.overallStatusBadge.className = `badge ${badgeClass}`;
  }

  private async handleReconnectWs(): Promise<void> {
    this.log("Demande de reconnexion WebSocket...", "info");
    try {
      await chrome.runtime.sendMessage({ type: "RECONNECT_WS" });
      if (this.activeTab?.id) {
        await chrome.tabs.sendMessage(this.activeTab.id, { type: "RECONNECT_WS" }).catch(() => {});
      }
      this.log("Signal de reconnexion envoyé", "success");
    } catch (err: any) {
      this.log(`Erreur reconnexion: ${err.message}`, "error");
    }
  }

  private async handlePingWs(): Promise<void> {
    this.log("Ping WebSocket en cours...", "info");
    this.showToast("Ping envoyé au daemon Obsidian");
    await this.refreshState();
  }

  private async handleCopyToken(): Promise<void> {
    if (!this.tokenData?.accessToken) return;

    try {
      await navigator.clipboard.writeText(this.tokenData.accessToken);
      this.showToast("Jeton JWT copié dans le presse-papiers !");
      this.log("Jeton JWT copié avec succès", "success");
    } catch (err: any) {
      this.log(`Erreur copie presse-papiers: ${err.message}`, "error");
    }
  }

  private async handleRefreshToken(): Promise<void> {
    if (!this.activeTab?.id) return;
    this.log("Extraction forcée du jeton Firebase...", "info");
    try {
      const res = await chrome.tabs.sendMessage(this.activeTab.id, { type: "EXTRACT_TOKEN" });
      if (res?.success && res.tokenData) {
        this.tokenData = res.tokenData;
        this.updateAuthUi(res.tokenData);
        this.showToast("Jeton Firebase extrait !");
        this.log(`Jeton extrait pour ${res.tokenData.email || res.tokenData.uid}`, "success");
      } else {
        this.log(`Échec extraction: ${res?.error || "Inconnu"}`, "error");
      }
    } catch (err: any) {
      this.log(`Erreur extraction: ${err.message}`, "error");
    }
  }

  private async handleTestDom(): Promise<void> {
    if (!this.activeTab?.id) return;
    this.log("Lancement du test d'automatisation DOM...", "info");
    try {
      const res = await chrome.tabs.sendMessage(this.activeTab.id, { type: "TEST_DOM_AUTOMATION" });
      if (res?.success) {
        this.log("Test DOM réussi (Highlighter & Angular status vérifiés)", "success");
        this.showToast("Test DOM réussi !");
      } else {
        this.log(`Échec test DOM: ${res?.error}`, "error");
      }
    } catch (err: any) {
      this.log(`Erreur test DOM: ${err.message}`, "error");
    }
  }

  private log(message: string, level: "info" | "success" | "warn" | "error" = "info"): void {
    const entry = document.createElement("div");
    const time = new Date().toLocaleTimeString();
    entry.className = `log-entry log-${level}`;
    entry.textContent = `[${time}] ${message}`;
    this.logsContainer.appendChild(entry);
    this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
  }

  private clearLogs(): void {
    this.logsContainer.innerHTML = "";
    this.log("Journal effacé", "info");
  }

  private showToast(message: string, durationMs = 2500): void {
    this.toast.textContent = message;
    this.toast.classList.remove("hidden");
    setTimeout(() => {
      this.toast.classList.add("hidden");
    }, durationMs);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new HarpyPopupController();
});
