import type {
  ClientCommand,
  DiplomacyCountrySummary,
  DiplomacyDetailPayload,
} from "../game/GameProtocol";
import {
  TREATY_DEFAULT_YEARS,
  TREATY_MAX_YEARS,
  TREATY_MIN_YEARS,
  TRADE_PRIVILEGE_ARTICLE_ID,
} from "../data/Diplomacy";
import type { BorderPolicy, DiplomacyProposal, DiplomacyTreaty, DiplomacyWar, PeaceMode } from "../data/Diplomacy";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";

export interface DiplomacyPanelData extends DiplomacyDetailPayload {
  factionName?: string;
  clockYear: number;
  onDiplomacyCommand?: (command: ClientCommand) => void;
  onClose?: () => void;
}

type DiplomacyTab = "overview" | "chat" | "treaties";

const STYLE_ID = "diplomacy-panel-style";
const DIPLOMACY_SCROLL_SELECTORS = [".diplomacyCountryList", ".diplomacyDetailScroll", ".diplomacyChatMessages"] as const;

export class DiplomacyPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: DiplomacyPanelData | null = null;
  private selectedFactionId: number | null = null;
  private activeTab: DiplomacyTab = "overview";
  private treatyYears = TREATY_DEFAULT_YEARS;
  private peaceYears = TREATY_DEFAULT_YEARS;
  private peaceMode: PeaceMode = "statusQuo";
  private confirmWarTargetId: number | null = null;
  private pendingRefreshData: DiplomacyPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
  private position = { x: 58, y: 60 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private readonly interactionGate = new PanelInteractionGate();

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.isDragging || !this.panelElement) return;
    ev.preventDefault();
    const rect = this.panelElement.getBoundingClientRect();
    this.position.x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, ev.clientX - this.dragOffset.x));
    this.position.y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ev.clientY - this.dragOffset.y));
    this.applyPosition();
  };

  private readonly onPointerUp = (): void => {
    this.isDragging = false;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  };

  constructor() {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
    this.injectStyles();
  }

  public show(data: DiplomacyPanelData): void {
    this.currentData = data;
    this.ensureSelection(data);
    const scrollState = captureScrollState(this.panelElement, DIPLOMACY_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "diplomacyPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: DiplomacyPanelData): void {
    if (!this.panelElement) return;
    this.currentData = data;
    if (this.shouldDeferRefresh()) {
      this.pendingRefreshData = data;
      this.schedulePendingRefresh();
      return;
    }
    this.show(data);
  }

  public close(): void {
    const onClose = this.currentData?.onClose;
    this.onPointerUp();
    this.clearPendingRefresh();
    this.interactionGate.clear();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    onClose?.();
  }

  public dispose(): void {
    this.close();
  }

  private render(data: DiplomacyPanelData): string {
    const selected = this.getSelectedCountry(data);
    const countryName = data.factionName ? `${data.factionName} Foreign Office` : "Foreign Office";
    return `
      <div class="diplomacyHeader" data-diplomacy-drag>
        <div class="diplomacyHeaderIcon">D</div>
        <div class="diplomacyHeaderText">
          <div class="diplomacyTitle">Diplomacy</div>
          <div class="diplomacySubtitle">${this.escapeHtml(countryName)}</div>
        </div>
        <button class="diplomacyClose" type="button" data-diplomacy-close aria-label="Close diplomacy">X</button>
      </div>
      <section class="diplomacyBody">
        <aside class="diplomacyCountries">
          <div class="diplomacySectionTitle">
            <strong>Countries</strong>
            <span>${data.countries.length} visible</span>
          </div>
          <div class="diplomacyCountryList">
            ${data.countries.map((country) => this.renderCountryRow(country)).join("")}
          </div>
        </aside>
        <main class="diplomacyDetail">
          ${selected ? this.renderSelectedCountry(data, selected) : this.renderEmptyState()}
        </main>
      </section>
    `;
  }

  private renderCountryRow(country: DiplomacyCountrySummary): string {
    const selected = country.faction.id === this.selectedFactionId;
    const status = this.getCountryStatus(country);
    return `
      <button class="diplomacyCountryRow ${selected ? "selected" : ""}" type="button" data-diplomacy-country="${country.faction.id}">
        <span class="diplomacyFlag" style="--country-color: ${this.colorToCss(country.faction.color, 0.95)}"></span>
        <span class="diplomacyCountryCopy">
          <strong>${this.escapeHtml(country.faction.name)}</strong>
          <small>${this.escapeHtml(status)}</small>
        </span>
        <span class="diplomacyCountryBadges">
          ${country.atWar ? '<em class="danger">War</em>' : ""}
          ${country.tradePrivilegeActive ? "<em>Trade</em>" : ""}
          ${country.tradePrivilegeSuspended ? '<em class="warn">Suspended</em>' : ""}
          ${country.pendingProposalCount > 0 ? `<em>${country.pendingProposalCount}</em>` : ""}
        </span>
      </button>
    `;
  }

  private renderSelectedCountry(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    return `
      <div class="diplomacyTargetHeader" style="--target-color: ${this.colorToCss(country.faction.color, 0.95)}">
        <span class="diplomacyTargetFlag"></span>
        <span>
          <strong>${this.escapeHtml(country.faction.name)}</strong>
          <small>${this.escapeHtml(this.getCountryStatus(country))}</small>
        </span>
      </div>
      <div class="diplomacyTabs">
        ${this.renderTab("overview", "Overview")}
        ${this.renderTab("chat", "Chat")}
        ${this.renderTab("treaties", "Treaties/Peace")}
      </div>
      <div class="diplomacyDetailScroll">
        ${this.activeTab === "overview" ? this.renderOverview(data, country) : ""}
        ${this.activeTab === "chat" ? this.renderChat(data, country) : ""}
        ${this.activeTab === "treaties" ? this.renderTreaties(data, country) : ""}
      </div>
    `;
  }

  private renderTab(tab: DiplomacyTab, label: string): string {
    return `
      <button class="${this.activeTab === tab ? "active" : ""}" type="button" data-diplomacy-tab="${tab}">
        ${this.escapeHtml(label)}
      </button>
    `;
  }

  private renderOverview(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    const disabled = !data.onDiplomacyCommand || country.isSelf;
    const confirmingWar = this.confirmWarTargetId === country.faction.id;
    return `
      <section class="diplomacyOverviewGrid">
        <div class="diplomacyStatBlock">
          <small>Our Border Toward Them</small>
          <strong>${this.formatBorder(country.ourBorderPolicy)}</strong>
          <div class="diplomacyInlineActions">
            <button type="button" data-diplomacy-border="open" ${disabled || country.ourBorderPolicy === "open" ? "disabled" : ""}>Open</button>
            <button type="button" data-diplomacy-border="closed" ${disabled || country.ourBorderPolicy === "closed" ? "disabled" : ""}>Close</button>
          </div>
        </div>
        <div class="diplomacyStatBlock">
          <small>Their Border Toward Us</small>
          <strong>${this.formatBorder(country.theirBorderPolicy)}</strong>
          <span class="diplomacyMuted">Controlled by ${this.escapeHtml(country.faction.name)}</span>
        </div>
        <div class="diplomacyStatBlock">
          <small>War State</small>
          <strong>${country.atWar ? "At War" : "No active war"}</strong>
          ${country.atWar || country.isSelf
            ? '<span class="diplomacyMuted">Military hostility follows active wars.</span>'
            : confirmingWar
              ? `
                <div class="diplomacyConfirm">
                  <span>Declare war immediately?</span>
                  <button type="button" class="danger" data-diplomacy-war-confirm="yes">Declare</button>
                  <button type="button" data-diplomacy-war-confirm="no">Cancel</button>
                </div>
              `
              : `<button type="button" class="danger" data-diplomacy-declare-war ${disabled ? "disabled" : ""}>Declare War</button>`}
        </div>
        <div class="diplomacyStatBlock">
          <small>Treaties</small>
          <strong>${country.activeTreatyCount}</strong>
          <span class="diplomacyMuted">${country.tradePrivilegeSuspended ? "Trade privilege suspended by war" : country.tradePrivilegeActive ? "Trade privilege active" : "No trade privilege"}</span>
        </div>
      </section>
    `;
  }

  private renderChat(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    const playerFactionId = data.playerFactionId;
    const messages = playerFactionId === null ? [] : data.chatMessages.filter((message) => (
      (message.fromFactionId === playerFactionId && message.toFactionId === country.faction.id)
      || (message.fromFactionId === country.faction.id && message.toFactionId === playerFactionId)
    ));
    return `
      <section class="diplomacyChat">
        <div class="diplomacyChatMessages">
          ${messages.length
            ? messages.map((message) => this.renderChatMessage(data, message.fromFactionId, message.body, message.createdAtYear)).join("")
            : '<div class="diplomacyEmpty">No messages in this channel.</div>'}
        </div>
        <form class="diplomacyChatForm" data-diplomacy-chat-form>
          <input type="text" maxlength="500" name="message" placeholder="Message" ${!data.onDiplomacyCommand || country.isSelf ? "disabled" : ""}>
          <button type="submit" ${!data.onDiplomacyCommand || country.isSelf ? "disabled" : ""}>Send</button>
        </form>
      </section>
    `;
  }

  private renderChatMessage(data: DiplomacyPanelData, fromFactionId: number, body: string, createdAtYear: number): string {
    const faction = data.countries.find((country) => country.faction.id === fromFactionId)?.faction;
    const own = data.playerFactionId === fromFactionId;
    return `
      <div class="diplomacyMessage ${own ? "own" : ""}">
        <small>${this.escapeHtml(faction?.name ?? `Faction ${fromFactionId}`)} - ${this.formatYear(createdAtYear)}</small>
        <span>${this.escapeHtml(body)}</span>
      </div>
    `;
  }

  private renderTreaties(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    const treaties = this.getTreatiesWith(data, country.faction.id);
    const proposals = this.getProposalsWith(data, country.faction.id);
    const war = this.getWarWith(data, country.faction.id);
    return `
      <section class="diplomacyTreatyLayout">
        ${this.renderTreatyProposal(data, country, treaties)}
        ${this.renderPendingProposals(data, proposals)}
        ${this.renderActiveTreaties(data, treaties)}
        ${war ? this.renderPeaceProposal(data, country, war) : this.renderPeaceInactive()}
      </section>
    `;
  }

  private renderTreatyProposal(data: DiplomacyPanelData, country: DiplomacyCountrySummary, treaties: DiplomacyTreaty[]): string {
    const tradeTreaty = treaties.find((treaty) => treaty.articleIds.includes(TRADE_PRIVILEGE_ARTICLE_ID));
    return `
      <div class="diplomacyTreatyCard">
        <div class="diplomacyCardHeader">
          <strong>Trade Privilege</strong>
          <span>Minimum term</span>
        </div>
        <p>Share 25% of internal market supply and demand. Suspends while at war.</p>
        <div class="diplomacyInlineActions">
          <input type="number" min="${TREATY_MIN_YEARS}" max="${TREATY_MAX_YEARS}" value="${this.treatyYears}" data-diplomacy-treaty-years>
          <button type="button" data-diplomacy-propose-trade ${!data.onDiplomacyCommand || country.isSelf ? "disabled" : ""}>
            ${tradeTreaty ? "Renegotiate" : "Propose"}
          </button>
        </div>
      </div>
    `;
  }

  private renderPendingProposals(data: DiplomacyPanelData, proposals: DiplomacyProposal[]): string {
    return `
      <div class="diplomacyTreatyCard">
        <div class="diplomacyCardHeader">
          <strong>Pending Proposals</strong>
          <span>${proposals.length}</span>
        </div>
        ${proposals.length ? proposals.map((proposal) => this.renderProposal(data, proposal)).join("") : '<div class="diplomacyEmpty compact">No pending proposals.</div>'}
      </div>
    `;
  }

  private renderProposal(data: DiplomacyPanelData, proposal: DiplomacyProposal): string {
    const sentByUs = proposal.fromFactionId === data.playerFactionId;
    const otherId = sentByUs ? proposal.toFactionId : proposal.fromFactionId;
    const other = data.countries.find((country) => country.faction.id === otherId)?.faction;
    const label = proposal.kind === "peace"
      ? `${proposal.peaceTerms?.mode === "whitePeace" ? "White peace" : "Status quo"} peace`
      : "Trade privilege treaty";
    return `
      <div class="diplomacyProposal">
        <span>
          <strong>${this.escapeHtml(label)}</strong>
          <small>${sentByUs ? "Sent to" : "From"} ${this.escapeHtml(other?.name ?? `Faction ${otherId}`)}</small>
        </span>
        <span class="diplomacyProposalActions">
          ${sentByUs
            ? `<button type="button" data-diplomacy-cancel-proposal="${this.escapeAttribute(proposal.id)}">Cancel</button>`
            : `
              <button type="button" data-diplomacy-respond="${this.escapeAttribute(proposal.id)}" data-response="accept">Accept</button>
              <button type="button" data-diplomacy-respond="${this.escapeAttribute(proposal.id)}" data-response="decline">Decline</button>
            `}
        </span>
      </div>
    `;
  }

  private renderActiveTreaties(data: DiplomacyPanelData, treaties: DiplomacyTreaty[]): string {
    return `
      <div class="diplomacyTreatyCard">
        <div class="diplomacyCardHeader">
          <strong>Active Treaties</strong>
          <span>${treaties.length}</span>
        </div>
        ${treaties.length ? treaties.map((treaty) => this.renderTreaty(data, treaty)).join("") : '<div class="diplomacyEmpty compact">No active treaties.</div>'}
      </div>
    `;
  }

  private renderTreaty(data: DiplomacyPanelData, treaty: DiplomacyTreaty): string {
    const partnerId = treaty.factionIds[0] === data.playerFactionId ? treaty.factionIds[1] : treaty.factionIds[0];
    const partner = data.countries.find((country) => country.faction.id === partnerId)?.faction;
    const early = data.clockYear < treaty.minimumEndYear;
    return `
      <div class="diplomacyProposal">
        <span>
          <strong>${treaty.articleIds.map((articleId) => this.articleName(articleId)).join(", ")}</strong>
          <small>${this.escapeHtml(partner?.name ?? `Faction ${partnerId}`)} - minimum until ${this.formatYear(treaty.minimumEndYear)}${early ? " - early cancel" : ""}</small>
        </span>
        <button type="button" data-diplomacy-cancel-treaty="${this.escapeAttribute(treaty.id)}">Cancel</button>
      </div>
    `;
  }

  private renderPeaceProposal(data: DiplomacyPanelData, country: DiplomacyCountrySummary, war: DiplomacyWar): string {
    const transfers = data.eligiblePeaceTransferSystems.filter((system) => (
      (system.fromFactionId === war.attackerFactionId && system.toFactionId === war.defenderFactionId)
      || (system.fromFactionId === war.defenderFactionId && system.toFactionId === war.attackerFactionId)
    ));
    return `
      <div class="diplomacyTreatyCard">
        <div class="diplomacyCardHeader">
          <strong>Peace Proposal</strong>
          <span>War since ${this.formatYear(war.startedAtYear)}</span>
        </div>
        <form class="diplomacyPeaceForm" data-diplomacy-peace-form>
          <label>
            <span>Settlement</span>
            <select name="mode" data-diplomacy-peace-mode>
              <option value="statusQuo" ${this.peaceMode === "statusQuo" ? "selected" : ""}>Status quo</option>
              <option value="whitePeace" ${this.peaceMode === "whitePeace" ? "selected" : ""}>White peace</option>
            </select>
          </label>
          <label class="diplomacyCheck">
            <input type="checkbox" name="enforceTrade">
            Enforce trade privilege
          </label>
          <label>
            <span>Enforced years</span>
            <input type="number" min="${TREATY_MIN_YEARS}" max="${TREATY_MAX_YEARS}" value="${this.peaceYears}" name="duration" data-diplomacy-peace-years>
          </label>
          <div class="diplomacyTransfers">
            ${transfers.length
              ? transfers.map((system) => this.renderPeaceTransferOption(data, system)).join("")
              : '<span class="diplomacyMuted">No starbase systems are eligible for transfer.</span>'}
          </div>
          <button type="submit" ${!data.onDiplomacyCommand || country.isSelf ? "disabled" : ""}>Propose Peace</button>
        </form>
      </div>
    `;
  }

  private renderPeaceInactive(): string {
    return `
      <div class="diplomacyTreatyCard">
        <div class="diplomacyCardHeader">
          <strong>Peace</strong>
          <span>Inactive</span>
        </div>
        <div class="diplomacyEmpty compact">Peace terms are available during an active war.</div>
      </div>
    `;
  }

  private renderPeaceTransferOption(
    data: DiplomacyPanelData,
    system: DiplomacyPanelData["eligiblePeaceTransferSystems"][number],
  ): string {
    const toName = data.countries.find((country) => country.faction.id === system.toFactionId)?.faction.name
      ?? `Faction ${system.toFactionId}`;
    return `
      <label class="diplomacyCheck">
        <input type="checkbox" name="transfer" value="${this.escapeAttribute(system.starbaseId)}">
        ${this.escapeHtml(system.starName)} from ${this.escapeHtml(system.ownerName)} to ${this.escapeHtml(toName)}
      </label>
    `;
  }

  private renderEmptyState(): string {
    return '<div class="diplomacyEmpty">No country selected.</div>';
  }

  private bindEvents(data: DiplomacyPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-diplomacy-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-diplomacy-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      if ((ev.target as HTMLElement).closest("button, input, select, textarea")) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-diplomacy-country]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedFactionId = Number(button.dataset.diplomacyCountry);
        this.confirmWarTargetId = null;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-diplomacy-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.diplomacyTab as DiplomacyTab | undefined;
        if (!tab) return;
        this.activeTab = tab;
        this.confirmWarTargetId = null;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-diplomacy-border]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = this.getSelectedCountry(data);
        const policy = button.dataset.diplomacyBorder as BorderPolicy | undefined;
        if (!target || !policy) return;
        data.onDiplomacyCommand?.({ type: "setBorderPolicy", targetFactionId: target.faction.id, policy });
      });
    });
    this.panelElement.querySelector<HTMLButtonElement>("[data-diplomacy-declare-war]")?.addEventListener("click", () => {
      const target = this.getSelectedCountry(data);
      if (!target) return;
      this.confirmWarTargetId = target.faction.id;
      this.show(data);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-diplomacy-war-confirm]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = this.getSelectedCountry(data);
        if (!target) return;
        const confirmed = button.dataset.diplomacyWarConfirm === "yes";
        this.confirmWarTargetId = null;
        if (confirmed) data.onDiplomacyCommand?.({ type: "declareWar", targetFactionId: target.faction.id });
        this.show(data);
      });
    });
    this.bindChat(data);
    this.bindTreaties(data);
  }

  private bindChat(data: DiplomacyPanelData): void {
    this.panelElement?.querySelector<HTMLFormElement>("[data-diplomacy-chat-form]")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const target = this.getSelectedCountry(data);
      const form = ev.currentTarget as HTMLFormElement;
      const input = form.elements.namedItem("message") as HTMLInputElement | null;
      const body = input?.value.trim() ?? "";
      if (!target || !body) return;
      data.onDiplomacyCommand?.({ type: "sendDiplomacyMessage", targetFactionId: target.faction.id, body });
      if (input) input.value = "";
    });
  }

  private bindTreaties(data: DiplomacyPanelData): void {
    this.panelElement?.querySelector<HTMLInputElement>("[data-diplomacy-treaty-years]")?.addEventListener("input", (ev) => {
      this.treatyYears = this.clampYears((ev.currentTarget as HTMLInputElement).value);
    });
    this.panelElement?.querySelector<HTMLInputElement>("[data-diplomacy-peace-years]")?.addEventListener("input", (ev) => {
      this.peaceYears = this.clampYears((ev.currentTarget as HTMLInputElement).value);
    });
    this.panelElement?.querySelector<HTMLSelectElement>("[data-diplomacy-peace-mode]")?.addEventListener("change", (ev) => {
      this.peaceMode = (ev.currentTarget as HTMLSelectElement).value === "whitePeace" ? "whitePeace" : "statusQuo";
    });
    this.panelElement?.querySelector<HTMLButtonElement>("[data-diplomacy-propose-trade]")?.addEventListener("click", () => {
      const target = this.getSelectedCountry(data);
      if (!target) return;
      const existing = this.getTreatiesWith(data, target.faction.id).find((treaty) => treaty.articleIds.includes(TRADE_PRIVILEGE_ARTICLE_ID));
      data.onDiplomacyCommand?.({
        type: "proposeTreaty",
        targetFactionId: target.faction.id,
        articleIds: [TRADE_PRIVILEGE_ARTICLE_ID],
        durationYears: this.treatyYears,
        replacesTreatyId: existing?.id ?? null,
      });
    });
    this.panelElement?.querySelectorAll<HTMLButtonElement>("[data-diplomacy-respond]").forEach((button) => {
      button.addEventListener("click", () => {
        const proposalId = button.dataset.diplomacyRespond;
        const response = button.dataset.response === "accept" ? "accept" : "decline";
        if (!proposalId) return;
        data.onDiplomacyCommand?.({ type: "respondDiplomacyProposal", proposalId, response });
      });
    });
    this.panelElement?.querySelectorAll<HTMLButtonElement>("[data-diplomacy-cancel-proposal]").forEach((button) => {
      button.addEventListener("click", () => {
        const proposalId = button.dataset.diplomacyCancelProposal;
        if (!proposalId) return;
        data.onDiplomacyCommand?.({ type: "cancelDiplomacyProposal", proposalId });
      });
    });
    this.panelElement?.querySelectorAll<HTMLButtonElement>("[data-diplomacy-cancel-treaty]").forEach((button) => {
      button.addEventListener("click", () => {
        const treatyId = button.dataset.diplomacyCancelTreaty;
        if (!treatyId) return;
        data.onDiplomacyCommand?.({ type: "cancelTreaty", treatyId });
      });
    });
    this.panelElement?.querySelector<HTMLFormElement>("[data-diplomacy-peace-form]")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const target = this.getSelectedCountry(data);
      if (!target) return;
      const form = ev.currentTarget as HTMLFormElement;
      const mode = ((form.elements.namedItem("mode") as HTMLSelectElement | null)?.value === "whitePeace" ? "whitePeace" : "statusQuo") as PeaceMode;
      const enforceTrade = (form.elements.namedItem("enforceTrade") as HTMLInputElement | null)?.checked === true;
      const selectedTransfers = new Set(Array.from(form.querySelectorAll<HTMLInputElement>('input[name="transfer"]:checked')).map((input) => input.value));
      const transfers = data.eligiblePeaceTransferSystems
        .filter((system) => selectedTransfers.has(system.starbaseId))
        .map((system) => ({
          starbaseId: system.starbaseId,
          fromFactionId: system.fromFactionId,
          toFactionId: system.toFactionId,
        }));
      data.onDiplomacyCommand?.({
        type: "proposePeace",
        targetFactionId: target.faction.id,
        terms: {
          mode,
          transfers,
          enforcedArticleIds: enforceTrade ? [TRADE_PRIVILEGE_ARTICLE_ID] : [],
          enforcedDurationYears: this.peaceYears,
        },
      });
    });
  }

  private schedulePendingRefresh(delayMs = 120): void {
    if (this.pendingRefreshTimer !== null) return;
    this.pendingRefreshTimer = window.setTimeout(() => {
      this.pendingRefreshTimer = null;
      if (!this.pendingRefreshData || !this.panelElement) return;
      if (this.shouldDeferRefresh()) {
        this.schedulePendingRefresh();
        return;
      }
      const data = this.pendingRefreshData;
      this.pendingRefreshData = null;
      this.show(data);
    }, delayMs);
  }

  private clearPendingRefresh(): void {
    if (this.pendingRefreshTimer !== null) {
      window.clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
    this.pendingRefreshData = null;
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || this.interactionGate.isBusy(this.panelElement);
  }

  private ensureSelection(data: DiplomacyPanelData): void {
    if (this.selectedFactionId !== null && data.countries.some((country) => country.faction.id === this.selectedFactionId)) return;
    this.selectedFactionId = data.countries.find((country) => !country.isSelf)?.faction.id ?? data.countries[0]?.faction.id ?? null;
  }

  private getSelectedCountry(data: DiplomacyPanelData): DiplomacyCountrySummary | null {
    return data.countries.find((country) => country.faction.id === this.selectedFactionId) ?? null;
  }

  private getTreatiesWith(data: DiplomacyPanelData, factionId: number): DiplomacyTreaty[] {
    const playerFactionId = data.playerFactionId;
    if (playerFactionId === null) return [];
    return data.treaties.filter((treaty) => (
      (treaty.factionIds[0] === playerFactionId && treaty.factionIds[1] === factionId)
      || (treaty.factionIds[0] === factionId && treaty.factionIds[1] === playerFactionId)
    ));
  }

  private getProposalsWith(data: DiplomacyPanelData, factionId: number): DiplomacyProposal[] {
    const playerFactionId = data.playerFactionId;
    if (playerFactionId === null) return [];
    return data.proposals.filter((proposal) => (
      (proposal.fromFactionId === playerFactionId && proposal.toFactionId === factionId)
      || (proposal.fromFactionId === factionId && proposal.toFactionId === playerFactionId)
    ));
  }

  private getWarWith(data: DiplomacyPanelData, factionId: number): DiplomacyWar | null {
    const playerFactionId = data.playerFactionId;
    if (playerFactionId === null) return null;
    return data.wars.find((war) => (
      (war.attackerFactionId === playerFactionId && war.defenderFactionId === factionId)
      || (war.attackerFactionId === factionId && war.defenderFactionId === playerFactionId)
    )) ?? null;
  }

  private getCountryStatus(country: DiplomacyCountrySummary): string {
    if (country.isSelf) return "Our country";
    if (country.atWar) return "Active war";
    if (country.tradePrivilegeActive) return "Trade privilege";
    if (country.pendingProposalCount > 0) return "Proposal pending";
    return "No active pact";
  }

  private articleName(articleId: string): string {
    if (articleId === TRADE_PRIVILEGE_ARTICLE_ID) return "Trade Privilege";
    return articleId;
  }

  private formatBorder(policy: BorderPolicy): string {
    return policy === "open" ? "Open" : "Closed";
  }

  private formatYear(year: number): string {
    return Number.isFinite(year) ? String(Math.round(year)) : "Unknown";
  }

  private clampYears(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return TREATY_DEFAULT_YEARS;
    return Math.max(TREATY_MIN_YEARS, Math.min(TREATY_MAX_YEARS, Math.round(numeric)));
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private colorToCss(color: readonly number[] | undefined, alpha = 1): string {
    if (!color || color.length < 3) return `rgba(74, 236, 214, ${alpha})`;
    const [r, g, b] = color.map((channel) => (
      channel <= 1 ? Math.round(channel * 255) : Math.round(channel)
    ));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.diplomacyPanel {
  position: fixed;
  z-index: 99;
  width: min(1040px, calc(100vw - 28px));
  height: min(628px, calc(100vh - 28px));
  pointer-events: auto;
  color: #e7fffb;
  background:
    radial-gradient(circle at 84% 9%, rgba(72, 255, 209, 0.12), transparent 18rem),
    linear-gradient(180deg, rgba(5, 29, 28, 0.99), rgba(2, 10, 13, 0.99));
  border: 1px solid rgba(73, 214, 164, 0.44);
  box-shadow: 0 24px 58px rgba(0, 0, 0, 0.62), inset 0 0 34px rgba(50, 187, 143, 0.08);
  border-radius: 0;
  overflow: hidden;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}
.diplomacyHeader {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  cursor: grab;
  background: linear-gradient(90deg, rgba(9, 58, 47, 0.92), rgba(3, 18, 22, 0.94));
  border-bottom: 1px solid rgba(65, 202, 153, 0.28);
}
.diplomacyHeaderIcon,
.diplomacyFlag,
.diplomacyTargetFlag {
  flex: 0 0 auto;
}
.diplomacyHeaderIcon {
  width: 36px;
  height: 30px;
  display: grid;
  place-items: center;
  color: #061915;
  font-weight: 900;
  border-radius: 3px;
  background: linear-gradient(135deg, #8dffd3, #f0d65d);
  box-shadow: 0 0 18px rgba(116, 255, 188, 0.22);
}
.diplomacyHeaderText {
  min-width: 0;
  flex: 1 1 auto;
}
.diplomacyTitle {
  color: #e5fff4;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.diplomacySubtitle {
  margin-top: 2px;
  color: rgba(156, 225, 194, 0.75);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.diplomacyClose {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(88, 255, 197, 0.55);
  color: #bffff0;
  background: rgba(8, 45, 37, 0.88);
  border-radius: 0;
}
.diplomacyBody {
  display: grid;
  grid-template-columns: 306px minmax(0, 1fr);
  height: calc(100% - 52px);
  min-height: 0;
}
.diplomacyCountries {
  border-right: 1px solid rgba(65, 202, 153, 0.22);
  background: rgba(2, 17, 18, 0.58);
  min-width: 0;
}
.diplomacySectionTitle,
.diplomacyCardHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.diplomacySectionTitle {
  padding: 12px 14px 9px;
}
.diplomacySectionTitle strong,
.diplomacyCardHeader strong {
  color: #74ffbc;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.diplomacySectionTitle span,
.diplomacyCardHeader span,
.diplomacyMuted {
  color: rgba(219, 255, 250, 0.58);
  font-size: 12px;
}
.diplomacyCountryList {
  height: calc(100% - 42px);
  overflow: auto;
  padding: 0 10px 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(73, 214, 164, 0.6) rgba(0, 0, 0, 0.28);
}
.diplomacyCountryRow {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin: 0 0 6px;
  padding: 8px;
  text-align: left;
  color: #eafffb;
  background: linear-gradient(90deg, rgba(10, 45, 38, 0.74), rgba(4, 18, 20, 0.86));
  border: 1px solid rgba(65, 202, 153, 0.24);
  border-radius: 0;
  cursor: pointer;
}
.diplomacyCountryRow.selected {
  border-color: rgba(240, 214, 93, 0.82);
  box-shadow: inset 0 0 18px rgba(240, 214, 93, 0.12);
}
.diplomacyFlag {
  width: 30px;
  height: 22px;
  border-radius: 2px;
  background:
    linear-gradient(135deg, var(--country-color), rgba(255, 255, 255, 0.12)),
    rgba(14, 52, 58, 0.95);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.26);
}
.diplomacyCountryCopy,
.diplomacyCountryCopy span,
.diplomacyMessage,
.diplomacyProposal span {
  min-width: 0;
}
.diplomacyCountryCopy strong,
.diplomacyTargetHeader strong,
.diplomacyProposal strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diplomacyCountryCopy small,
.diplomacyTargetHeader small,
.diplomacyMessage small,
.diplomacyProposal small {
  display: block;
  margin-top: 3px;
  color: rgba(219, 255, 250, 0.58);
  font-size: 11px;
}
.diplomacyCountryBadges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.diplomacyCountryBadges em,
.diplomacySelectedBadge {
  padding: 3px 5px;
  color: #071b1e;
  background: rgba(116, 255, 188, 0.82);
  border-radius: 2px;
  font-size: 8px;
  font-style: normal;
  font-weight: 800;
}
.diplomacyCountryBadges .danger,
.diplomacyPanel .danger {
  background: rgba(255, 102, 116, 0.92);
  color: #26070b;
}
.diplomacyCountryBadges .warn {
  background: rgba(255, 210, 106, 0.92);
  color: #221703;
}
.diplomacyDetail {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.diplomacyTargetHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid rgba(65, 202, 153, 0.16);
  background: rgba(2, 16, 16, 0.42);
}
.diplomacyTargetFlag {
  width: 42px;
  height: 30px;
  border-radius: 2px;
  background: linear-gradient(135deg, var(--target-color), rgba(255, 255, 255, 0.14));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}
.diplomacyTabs {
  display: flex;
  gap: 8px;
  padding: 8px 14px 0;
  border-bottom: 1px solid rgba(65, 202, 153, 0.16);
}
.diplomacyTabs button {
  min-height: 32px;
  padding: 0 14px;
  color: rgba(211, 239, 225, 0.82);
  background: rgba(8, 31, 28, 0.5);
  border: 1px solid transparent;
  border-bottom-color: rgba(221, 187, 72, 0.34);
  border-radius: 0;
}
.diplomacyTabs button.active {
  color: #f0d65d;
  background: linear-gradient(180deg, rgba(42, 64, 38, 0.7), rgba(11, 34, 27, 0.7));
  border-color: rgba(221, 187, 72, 0.7);
}
.diplomacyDetailScroll {
  overflow: auto;
  padding: 12px 14px 14px;
  height: calc(100% - 107px);
  scrollbar-width: thin;
  scrollbar-color: rgba(73, 214, 164, 0.6) rgba(0, 0, 0, 0.28);
}
.diplomacyOverviewGrid,
.diplomacyTreatyLayout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.diplomacyStatBlock,
.diplomacyTreatyCard {
  min-width: 0;
  padding: 12px;
  background: rgba(4, 20, 22, 0.82);
  border: 1px solid rgba(65, 202, 153, 0.28);
  border-radius: 0;
}
.diplomacyStatBlock small {
  display: block;
  color: rgba(219, 255, 250, 0.6);
  font-size: 11px;
  text-transform: uppercase;
}
.diplomacyStatBlock strong {
  display: block;
  margin: 7px 0 10px;
  color: #f0d65d;
  font-size: 15px;
}
.diplomacyInlineActions,
.diplomacyConfirm,
.diplomacyProposalActions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.diplomacyPanel button,
.diplomacyPanel input,
.diplomacyPanel select {
  font: inherit;
}
.diplomacyPanel button {
  min-height: 32px;
  padding: 0 12px;
  color: #eafffb;
  background: rgba(7, 35, 31, 0.86);
  border: 1px solid rgba(84, 202, 164, 0.42);
  border-radius: 0;
  cursor: pointer;
}
.diplomacyPanel button:hover:not(:disabled) {
  border-color: rgba(240, 214, 93, 0.72);
  background: rgba(23, 58, 45, 0.96);
}
.diplomacyPanel button:disabled,
.diplomacyPanel button.disabled,
.diplomacyPanel input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.diplomacyPanel input,
.diplomacyPanel select {
  min-height: 32px;
  color: #eafffb;
  background: rgba(2, 13, 18, 0.82);
  border: 1px solid rgba(84, 202, 164, 0.42);
  border-radius: 0;
  padding: 0 10px;
}
.diplomacyPanel input[type="number"] {
  width: 84px;
}
.diplomacyConfirm span {
  flex: 1 1 100%;
  color: rgba(255, 220, 222, 0.85);
  font-size: 12px;
}
.diplomacyChat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 390px;
}
.diplomacyChatMessages {
  flex: 1 1 auto;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(4, 16, 21, 0.66);
  border: 1px solid rgba(65, 202, 153, 0.22);
  border-radius: 0;
}
.diplomacyMessage {
  max-width: 78%;
  padding: 9px 11px;
  background: rgba(19, 65, 73, 0.82);
  border: 1px solid rgba(65, 202, 153, 0.18);
  border-radius: 0;
}
.diplomacyMessage.own {
  align-self: flex-end;
  background: rgba(35, 112, 116, 0.84);
}
.diplomacyMessage span {
  display: block;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.35;
}
.diplomacyChatForm {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.diplomacyChatForm input {
  width: 100%;
}
.diplomacyTreatyCard p {
  margin: 10px 0 12px;
  color: rgba(230, 255, 252, 0.72);
  font-size: 12px;
  line-height: 1.45;
}
.diplomacyProposal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid rgba(125, 234, 219, 0.12);
}
.diplomacyProposal:first-of-type {
  border-top: 0;
}
.diplomacyPeaceForm {
  display: grid;
  gap: 10px;
}
.diplomacyPeaceForm label:not(.diplomacyCheck) {
  display: grid;
  gap: 5px;
  color: rgba(230, 255, 252, 0.72);
  font-size: 12px;
}
.diplomacyCheck {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(230, 255, 252, 0.8);
  font-size: 12px;
}
.diplomacyCheck input {
  min-height: auto;
  width: 16px;
  height: 16px;
}
.diplomacyTransfers {
  display: grid;
  gap: 8px;
  padding: 8px;
  background: rgba(4, 16, 21, 0.56);
  border: 1px solid rgba(65, 202, 153, 0.18);
  border-radius: 0;
}
.diplomacyEmpty {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: rgba(219, 255, 250, 0.58);
  border: 1px dashed rgba(65, 202, 153, 0.24);
  border-radius: 0;
}
.diplomacyEmpty.compact {
  min-height: 62px;
}
@media (max-width: 860px) {
  .diplomacyBody {
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .diplomacyCountries {
    border-right: 0;
    border-bottom: 1px solid rgba(111, 236, 218, 0.18);
  }
  .diplomacyCountryList {
    max-height: 210px;
  }
  .diplomacyOverviewGrid,
  .diplomacyTreatyLayout {
    grid-template-columns: 1fr;
  }
}
`;
    document.head.appendChild(style);
  }
}
