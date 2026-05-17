import {
  ADMIN_COMMAND_DEFINITIONS,
  formatAdminCommandHelp,
} from "../game/AdminCommands";
import type { AdminCommandDefinition, AdminCommandResult } from "../game/AdminCommands";

export interface AdminCommandPanelOptions {
  onCommand: (input: string) => Promise<AdminCommandResult>;
}

type AdminPanelTab = "console" | "commands";

export class AdminCommandPanel {
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private output: HTMLDivElement | null = null;
  private commandList: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private tab: AdminPanelTab = "console";
  private history: string[] = [];
  private historyIndex = -1;
  private pendingConfirmation: string | null = null;

  constructor(private readonly options: AdminCommandPanelOptions) {
    this.injectStyles();
  }

  toggle(): void {
    if (this.root) {
      this.dispose();
      return;
    }
    this.show();
  }

  show(): void {
    if (this.root) {
      this.input?.focus();
      return;
    }

    const root = document.createElement("div");
    root.className = "adminCommandPanel";
    root.innerHTML = `
      <div class="adminCommandHeader">
        <div>
          <strong>Admin Commands</strong>
          <span>Shift + N + 2</span>
        </div>
        <button type="button" data-admin-close>Close</button>
      </div>
      <div class="adminCommandTabs">
        <button type="button" data-admin-tab="console" class="active">Console</button>
        <button type="button" data-admin-tab="commands">Commands</button>
      </div>
      <div class="adminCommandBody" data-admin-body="console">
        <div class="adminCommandOutput" data-admin-output></div>
        <div class="adminCommandInputRow">
          <span>&gt;</span>
          <input data-admin-input autocomplete="off" spellcheck="false" placeholder="help, tick_speed 0.5, start_duel current me 1 countA=5 countB=5" />
          <button type="button" data-admin-run>Run</button>
        </div>
        <div class="adminCommandConfirm" data-admin-confirm hidden>
          <span data-admin-confirm-text></span>
          <button type="button" data-admin-confirm-run>Run with --confirm</button>
        </div>
      </div>
      <div class="adminCommandBody" data-admin-body="commands" hidden>
        <input data-admin-search autocomplete="off" spellcheck="false" placeholder="Search commands" />
        <div class="adminCommandPalette" data-admin-command-list></div>
      </div>
    `;

    document.body.appendChild(root);
    this.root = root;
    this.input = root.querySelector("[data-admin-input]");
    this.output = root.querySelector("[data-admin-output]");
    this.commandList = root.querySelector("[data-admin-command-list]");
    this.search = root.querySelector("[data-admin-search]");

    root.querySelector("[data-admin-close]")?.addEventListener("click", () => this.dispose());
    root.querySelector("[data-admin-run]")?.addEventListener("click", () => void this.runCurrentInput());
    root.querySelector("[data-admin-confirm-run]")?.addEventListener("click", () => void this.runConfirmation());
    root.querySelectorAll<HTMLButtonElement>("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => this.setTab((button.dataset.adminTab as AdminPanelTab) ?? "console"));
    });
    this.input?.addEventListener("keydown", (ev) => this.handleInputKey(ev));
    this.search?.addEventListener("input", () => this.renderCommandPalette());
    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        this.dispose();
      }
    });

    this.appendOutput({ ok: true, message: "Admin console ready. Type help or use the Commands tab." });
    this.renderCommandPalette();
    this.input?.focus();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.input = null;
    this.output = null;
    this.commandList = null;
    this.search = null;
    this.pendingConfirmation = null;
  }

  private setTab(tab: AdminPanelTab): void {
    this.tab = tab;
    this.root?.querySelectorAll<HTMLButtonElement>("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === tab);
    });
    this.root?.querySelectorAll<HTMLElement>("[data-admin-body]").forEach((body) => {
      body.hidden = body.dataset.adminBody !== tab;
    });
    if (tab === "console") this.input?.focus();
    else this.search?.focus();
  }

  private handleInputKey(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void this.runCurrentInput();
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      this.recallHistory(-1);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      this.recallHistory(1);
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      this.autocomplete();
    }
  }

  private recallHistory(delta: number): void {
    if (!this.input || this.history.length === 0) return;
    if (this.historyIndex < 0) this.historyIndex = this.history.length;
    this.historyIndex = Math.max(0, Math.min(this.history.length - 1, this.historyIndex + delta));
    this.input.value = this.history[this.historyIndex] ?? "";
  }

  private autocomplete(): void {
    if (!this.input) return;
    const tokens = this.input.value.trim().split(/\s+/);
    const prefix = tokens[0]?.toLowerCase() ?? "";
    if (!prefix) return;
    const match = ADMIN_COMMAND_DEFINITIONS.find((definition) => (
      definition.name.startsWith(prefix) || definition.aliases?.some((alias) => alias.startsWith(prefix))
    ));
    if (!match) return;
    tokens[0] = match.name;
    this.input.value = tokens.join(" ");
  }

  private async runCurrentInput(): Promise<void> {
    const input = this.input?.value.trim() ?? "";
    if (!input) return;
    this.pendingConfirmation = null;
    this.setConfirmation(null);
    this.history.push(input);
    this.historyIndex = -1;
    this.appendOutput({ ok: true, message: `> ${input}` });
    if (this.input) this.input.value = "";

    try {
      const result = await this.options.onCommand(input);
      this.appendOutput(result);
      if (result.requiresConfirmation) {
        this.pendingConfirmation = input.includes("--confirm") ? input : `${input} --confirm`;
        this.setConfirmation(result.message);
      }
    } catch (error) {
      this.appendOutput({
        ok: false,
        message: error instanceof Error ? error.message : "Command failed.",
      });
    }
  }

  private async runConfirmation(): Promise<void> {
    if (!this.pendingConfirmation || !this.input) return;
    this.input.value = this.pendingConfirmation;
    this.pendingConfirmation = null;
    this.setConfirmation(null);
    await this.runCurrentInput();
  }

  private setConfirmation(message: string | null): void {
    const box = this.root?.querySelector<HTMLElement>("[data-admin-confirm]");
    const text = this.root?.querySelector<HTMLElement>("[data-admin-confirm-text]");
    if (!box || !text) return;
    box.hidden = !message;
    text.textContent = message ?? "";
  }

  private appendOutput(result: Partial<AdminCommandResult>): void {
    if (!this.output) return;
    const item = document.createElement("div");
    item.className = `adminCommandOutputItem ${result.ok === false ? "error" : "ok"}`;
    const rows = result.rows?.length
      ? `<table>${this.renderRows(result.rows)}</table>`
      : "";
    item.innerHTML = `
      <div class="adminCommandMessage">${this.escapeHtml(result.message ?? "")}</div>
      ${rows}
    `;
    this.output.appendChild(item);
    this.output.scrollTop = this.output.scrollHeight;
  }

  private renderRows(rows: NonNullable<AdminCommandResult["rows"]>): string {
    const keys = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    const head = `<thead><tr>${keys.map((key) => `<th>${this.escapeHtml(key)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${rows.slice(0, 80).map((row) => (
      `<tr>${keys.map((key) => `<td>${this.escapeHtml(String(row[key] ?? ""))}</td>`).join("")}</tr>`
    )).join("")}</tbody>`;
    return `${head}${body}`;
  }

  private renderCommandPalette(): void {
    if (!this.commandList) return;
    const query = this.search?.value.trim().toLowerCase() ?? "";
    const definitions = ADMIN_COMMAND_DEFINITIONS.filter((definition) => {
      if (!query) return true;
      return `${definition.name} ${definition.category} ${definition.description} ${definition.syntax}`.toLowerCase().includes(query);
    });
    this.commandList.innerHTML = definitions.map((definition) => this.renderCommandCard(definition)).join("");
    this.commandList.querySelectorAll<HTMLButtonElement>("[data-admin-use]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.adminUse;
        const definition = ADMIN_COMMAND_DEFINITIONS.find((candidate) => candidate.name === name);
        if (!definition || !this.input) return;
        this.input.value = this.templateForDefinition(definition);
        this.setTab("console");
        this.input.focus();
      });
    });
  }

  private renderCommandCard(definition: AdminCommandDefinition): string {
    const row = formatAdminCommandHelp(definition);
    return `
      <article class="adminCommandCard">
        <div>
          <strong>${this.escapeHtml(definition.name)}</strong>
          <span>${this.escapeHtml(definition.category)}${definition.destructive ? " | destructive" : ""}${definition.localOnly ? " | local" : ""}</span>
        </div>
        <p>${this.escapeHtml(definition.description)}</p>
        <code>${this.escapeHtml(String(row.syntax))}</code>
        <button type="button" data-admin-use="${this.escapeHtml(definition.name)}">Use</button>
      </article>
    `;
  }

  private templateForDefinition(definition: AdminCommandDefinition): string {
    return definition.examples?.[0] ?? definition.syntax
      .replace(/\[/g, "")
      .replace(/\]/g, "")
      .replace(/<([^>]+)>/g, (_match, value: string) => value.split("|")[0] ?? value);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private injectStyles(): void {
    const styleId = "admin-command-panel-style";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.adminCommandPanel {
  position: fixed;
  left: 50%;
  top: 52px;
  width: min(980px, calc(100vw - 48px));
  max-height: min(720px, calc(100vh - 96px));
  transform: translateX(-50%);
  z-index: 120;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border: 1px solid rgba(112, 211, 255, 0.72);
  background: rgba(4, 11, 18, 0.96);
  color: #e9f7ff;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.68);
  font-family: "Rajdhani", "Trebuchet MS", sans-serif;
}
.adminCommandHeader,
.adminCommandTabs,
.adminCommandInputRow,
.adminCommandConfirm {
  display: flex;
  align-items: center;
  gap: 8px;
}
.adminCommandHeader {
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(112, 211, 255, 0.24);
}
.adminCommandHeader strong {
  display: block;
  font-size: 18px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.adminCommandHeader span {
  color: rgba(213, 234, 246, 0.62);
  font-size: 12px;
}
.adminCommandPanel button {
  border: 1px solid rgba(143, 195, 230, 0.52);
  background: rgba(18, 31, 43, 0.92);
  color: #ecf7ff;
  min-height: 30px;
  padding: 5px 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.adminCommandPanel button:hover,
.adminCommandTabs button.active {
  border-color: rgba(116, 219, 255, 0.9);
  background: rgba(29, 74, 95, 0.92);
}
.adminCommandTabs {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(112, 211, 255, 0.16);
}
.adminCommandBody {
  min-height: 0;
  padding: 10px 12px 12px;
}
.adminCommandOutput {
  height: 360px;
  overflow: auto;
  border: 1px solid rgba(112, 211, 255, 0.2);
  background: rgba(0, 0, 0, 0.28);
  padding: 8px;
}
.adminCommandOutputItem {
  padding: 5px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.adminCommandOutputItem.error .adminCommandMessage {
  color: #ff9b84;
}
.adminCommandOutputItem.ok .adminCommandMessage {
  color: #bdeaff;
}
.adminCommandOutput table {
  width: 100%;
  margin-top: 5px;
  border-collapse: collapse;
  font-size: 12px;
}
.adminCommandOutput th,
.adminCommandOutput td {
  border: 1px solid rgba(112, 211, 255, 0.14);
  padding: 3px 5px;
  text-align: left;
}
.adminCommandInputRow {
  margin-top: 8px;
}
.adminCommandInputRow input,
.adminCommandBody > input {
  flex: 1;
  width: 100%;
  min-height: 34px;
  border: 1px solid rgba(112, 211, 255, 0.42);
  background: rgba(3, 9, 14, 0.96);
  color: #f2fbff;
  padding: 5px 8px;
  font: 14px Consolas, "Courier New", monospace;
}
.adminCommandConfirm {
  margin-top: 8px;
  justify-content: space-between;
  border: 1px solid rgba(255, 173, 95, 0.42);
  background: rgba(55, 30, 10, 0.55);
  padding: 7px;
  color: #ffd7a3;
}
.adminCommandPalette {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px;
  max-height: 500px;
  overflow: auto;
  margin-top: 8px;
}
.adminCommandCard {
  display: grid;
  gap: 5px;
  border: 1px solid rgba(112, 211, 255, 0.2);
  background: rgba(7, 19, 27, 0.78);
  padding: 8px;
}
.adminCommandCard strong {
  color: #9de5ff;
  letter-spacing: 0.05em;
}
.adminCommandCard span {
  display: block;
  color: rgba(223, 239, 248, 0.54);
  font-size: 11px;
}
.adminCommandCard p {
  margin: 0;
  color: rgba(231, 242, 247, 0.78);
  font-size: 12px;
}
.adminCommandCard code {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #ffd37a;
}
body.admin-hide-system-labels .systemEntityCardLayer {
  display: none !important;
}
`;
    document.head.appendChild(style);
  }
}
