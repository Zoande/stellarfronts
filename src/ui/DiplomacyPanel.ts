import type {
  ClientCommand,
  DiplomacyCountrySummary,
  DiplomacyDetailPayload,
} from "../game/GameProtocol";
import {
  TREATY_DEFAULT_YEARS,
  TREATY_MAX_YEARS,
  TREATY_MIN_YEARS,
  MIGRATION_PACT_ARTICLE_ID,
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

type DiplomacyTab = "overview" | "treaties" | "chat";

const STYLE_ID = "diplomacy-panel-style";
const DIPLOMACY_SCROLL_SELECTORS = [".diplomacyCountryList", ".diplomacyDetailScroll", ".diplomacyChatMessages"] as const;

export class DiplomacyPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: DiplomacyPanelData | null = null;
  private selectedFactionId: number | null = null;
  private activeTab: DiplomacyTab = "overview";
  private countrySearch = "";
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
    const countries = this.getFilteredCountries(data);
    return `
      <div class="diplomacyHeader" data-diplomacy-drag>
        <div class="diplomacyHeaderIcon"><span></span></div>
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
          <div class="diplomacySearchRow">
            <span class="diplomacySearchIcon" aria-hidden="true"></span>
            <input type="search" value="${this.escapeAttribute(this.countrySearch)}" placeholder="Search countries..." aria-label="Search countries" data-diplomacy-country-search>
            <button type="button" aria-label="Filter countries"><span class="diplomacyFilterIcon" aria-hidden="true"></span></button>
          </div>
          <div class="diplomacyCountryList">
            ${countries.length
              ? countries.map((country) => this.renderCountryRow(country)).join("")
              : '<div class="diplomacyEmpty compact">No countries match that search.</div>'}
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
    const attitude = this.getCountryAttitude(country);
    return `
      <button class="diplomacyCountryRow ${selected ? "selected" : ""}" type="button" data-diplomacy-country="${country.faction.id}">
        <span class="diplomacyFlag" style="--country-color: ${this.colorToCss(country.faction.color, 0.95)}"></span>
        <span class="diplomacyCountryCopy">
          <strong>${this.escapeHtml(country.faction.name)}</strong>
          <small>${this.escapeHtml(status)}</small>
        </span>
        <span class="diplomacyCountryBadges">
          <em class="${this.escapeAttribute(this.getAttitudeClass(attitude))}">${this.escapeHtml(attitude)}</em>
          ${country.tradePrivilegeSuspended ? '<em class="warn">Suspended</em>' : ""}
          ${country.migrationPactActive ? '<em class="friendly">Migration</em>' : ""}
          ${country.migrationPactSuspended ? '<em class="warn">Migration paused</em>' : ""}
          ${country.pendingProposalCount > 0 ? `<em>${country.pendingProposalCount}</em>` : ""}
        </span>
      </button>
    `;
  }

  private renderSelectedCountry(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    const attitude = this.getCountryAttitude(country);
    const treatySummary = country.tradePrivilegeSuspended
      ? "Trade suspended by war"
      : country.tradePrivilegeActive
        ? "Trade privilege active"
        : country.migrationPactSuspended
          ? "Migration pact suspended by war"
          : country.migrationPactActive
            ? "Migration pact active"
        : country.activeTreatyCount > 0
          ? `${country.activeTreatyCount} active treaty${country.activeTreatyCount === 1 ? "" : "ies"}`
          : "No active pact";
    return `
      <div class="diplomacyTargetHeader" style="--target-color: ${this.colorToCss(country.faction.color, 0.95)}">
        <span class="diplomacyTargetFlag"></span>
        <span class="diplomacyTargetSeal" aria-hidden="true"></span>
        <div class="diplomacyTargetIdentity">
          <strong>${this.escapeHtml(country.faction.name)}</strong>
          <small>${this.escapeHtml(treatySummary)}</small>
          <span class="diplomacyAttitude ${this.escapeAttribute(this.getAttitudeClass(attitude))}">${this.escapeHtml(attitude)}</span>
          <div class="diplomacyRelationMeter" aria-hidden="true">
            ${Array.from({ length: 7 }, (_, index) => `<i class="${index < this.getRelationMeterValue(country) ? "filled" : ""}"></i>`).join("")}
          </div>
        </div>
        <div class="diplomacyTargetMetrics">
          ${this.renderTargetMetric("Power", country.atWar ? "Hostile" : "Medium", "power")}
          ${this.renderTargetMetric("Systems", String(country.faction.discoveredStarIds.length), "systems")}
          ${this.renderTargetMetric("Treaties", String(country.activeTreatyCount), "treaty")}
          ${this.renderTargetMetric("Proposals", String(country.pendingProposalCount), "proposal")}
        </div>
      </div>
      <div class="diplomacyTabs">
        ${this.renderTab("overview", "Overview")}
        ${this.renderTab("treaties", "Treaties")}
        ${this.renderTab("chat", "Chat")}
      </div>
      <div class="diplomacyDetailScroll">
        ${this.activeTab === "overview" ? this.renderOverview(data, country) : ""}
        ${this.activeTab === "treaties" ? this.renderTreaties(data, country) : ""}
        ${this.activeTab === "chat" ? this.renderChat(data, country) : ""}
      </div>
    `;
  }

  private renderTargetMetric(label: string, value: string, icon: string): string {
    return `
      <span class="diplomacyMetric">
        <i class="diplomacyMetricIcon diplomacyMetric-${this.escapeAttribute(icon)}" aria-hidden="true"></i>
        <small>${this.escapeHtml(label)}</small>
        <strong>${this.escapeHtml(value)}</strong>
      </span>
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
    const war = this.getWarWith(data, country.faction.id);
    const proposals = this.getProposalsWith(data, country.faction.id);
    return `
      <section class="diplomacyOverviewGrid">
        <article class="diplomacyCommandCard diplomacyWide">
          <span class="diplomacyCardIcon diplomacyIcon-border" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Border Status</div>
            <div class="diplomacyTwoColumn">
              <div>
                <small>Our border toward them</small>
                <strong>${this.formatBorder(country.ourBorderPolicy)}</strong>
                <div class="diplomacyInlineActions">
                  <button type="button" data-diplomacy-border="open" ${disabled || country.ourBorderPolicy === "open" ? "disabled" : ""}>Open Borders</button>
                  <button type="button" data-diplomacy-border="closed" ${disabled || country.ourBorderPolicy === "closed" ? "disabled" : ""}>Close Borders</button>
                </div>
              </div>
              <div>
                <small>Their border toward us</small>
                <strong>${this.formatBorder(country.theirBorderPolicy)}</strong>
                <span class="diplomacyMuted">Controlled by ${this.escapeHtml(country.faction.name)}</span>
              </div>
            </div>
          </div>
        </article>
        <article class="diplomacyCommandCard">
          <span class="diplomacyCardIcon diplomacyIcon-stance" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Diplomatic Stance</div>
            <p>Derived from border access, treaties, proposals, and war state.</p>
            <strong>${this.escapeHtml(this.getCountryAttitude(country))}</strong>
            <span class="diplomacyMuted">${this.escapeHtml(this.getCountryStatus(country))}</span>
          </div>
        </article>
        <article class="diplomacyCommandCard">
          <span class="diplomacyCardIcon diplomacyIcon-war" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">War State</div>
            <strong>${country.atWar ? "At War" : "No active war"}</strong>
            <p>${war ? `Conflict began in ${this.formatYear(war.startedAtYear)}.` : `We are not engaged in any military conflict with ${this.escapeHtml(country.faction.name)}.`}</p>
            ${country.atWar || country.isSelf
              ? ""
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
        </article>
        <article class="diplomacyCommandCard">
          <span class="diplomacyCardIcon diplomacyIcon-trade" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Trade Privileges</div>
            <strong>${country.tradePrivilegeActive ? "Active" : country.tradePrivilegeSuspended ? "Suspended" : "None"}</strong>
            <p>${country.tradePrivilegeSuspended ? "Trade privilege is suspended by war." : country.tradePrivilegeActive ? "Shared internal market access is active." : "No trade privilege."}</p>
            <button type="button" data-diplomacy-tab="treaties" ${country.isSelf ? "disabled" : ""}>Treaty Desk</button>
          </div>
        </article>
        <article class="diplomacyCommandCard">
          <span class="diplomacyCardIcon diplomacyIcon-treaty" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Migration Pact</div>
            <strong>${country.migrationPactActive ? "Active" : country.migrationPactSuspended ? "Suspended" : "None"}</strong>
            <p>${country.migrationPactSuspended ? "Migration pact is suspended by war." : country.migrationPactActive ? "Civilian migration is strongly encouraged between both empires." : "No migration pact."}</p>
            <button type="button" data-diplomacy-tab="treaties" ${country.isSelf ? "disabled" : ""}>Treaty Desk</button>
          </div>
        </article>
        <article class="diplomacyCommandCard">
          <span class="diplomacyCardIcon diplomacyIcon-treaty" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Treaties</div>
            <strong>${country.activeTreatyCount}</strong>
            <p>${proposals.length > 0 ? `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} pending.` : "No pending proposal."}</p>
            <button type="button" data-diplomacy-tab="treaties" ${country.isSelf ? "disabled" : ""}>Treaty Desk</button>
          </div>
        </article>
        <article class="diplomacyCommandCard diplomacyWide diplomacyIntelCard">
          <span class="diplomacyCardIcon diplomacyIcon-intel" aria-hidden="true"></span>
          <div class="diplomacyCardBody">
            <div class="diplomacyCardEyebrow">Intel Summary</div>
            <p>Current intelligence is limited to discovered systems and diplomatic records.</p>
            <div class="diplomacyIntelGrid">
              <span>Known Systems <strong>${country.faction.discoveredStarIds.length}</strong></span>
              <span>Border Access <strong>${this.formatBorder(country.theirBorderPolicy)}</strong></span>
              <span>Peace Transfers <strong>${this.getEligibleTransfersWith(data, country.faction.id).length}</strong></span>
              <span>Messages <strong>${this.getMessagesWith(data, country.faction.id).length}</strong></span>
            </div>
          </div>
        </article>
      </section>
    `;
  }

  private renderChat(data: DiplomacyPanelData, country: DiplomacyCountrySummary): string {
    const messages = this.getMessagesWith(data, country.faction.id);
    return `
      <section class="diplomacyChat">
        <div class="diplomacyChatHeader">
          <strong>Diplomatic Channel</strong>
          <span>${messages.length} message${messages.length === 1 ? "" : "s"}</span>
        </div>
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
        <div class="diplomacyTreatyColumn">
          ${this.renderTreatyProposal(data, country, treaties)}
          ${this.renderPendingProposals(data, proposals)}
        </div>
        <div class="diplomacyTreatyColumn">
          ${this.renderActiveTreaties(data, treaties)}
          ${war ? this.renderPeaceProposal(data, country, war) : this.renderPeaceInactive()}
        </div>
      </section>
    `;
  }

  private renderTreatyProposal(data: DiplomacyPanelData, country: DiplomacyCountrySummary, treaties: DiplomacyTreaty[]): string {
    const tradeTreaty = treaties.find((treaty) => treaty.articleIds.includes(TRADE_PRIVILEGE_ARTICLE_ID));
    const tradeArticle = data.treatyArticles.find((article) => article.id === TRADE_PRIVILEGE_ARTICLE_ID);
    const migrationTreaty = treaties.find((treaty) => treaty.articleIds.includes(MIGRATION_PACT_ARTICLE_ID));
    const migrationArticle = data.treatyArticles.find((article) => article.id === MIGRATION_PACT_ARTICLE_ID);
    const disabled = !data.onDiplomacyCommand || country.isSelf || (!tradeArticle && !migrationArticle);
    return `
      <form class="diplomacyTreatyCard diplomacyTreatyComposer" data-diplomacy-treaty-form>
        <div class="diplomacyCardHeader">
          <strong>Send Treaty</strong>
          <span>${tradeTreaty || migrationTreaty ? "Renegotiation" : "New Proposal"}</span>
        </div>
        <p>Choose bilateral terms. Treaty articles suspend while both countries are at war.</p>
        <div class="diplomacyTermGrid">
          ${tradeArticle ? `
            <label class="diplomacyTermCard">
              <input type="checkbox" name="tradePrivilege" data-diplomacy-treaty-term="${TRADE_PRIVILEGE_ARTICLE_ID}" checked ${disabled ? "disabled" : ""}>
              <span>
                <strong>${this.escapeHtml(tradeArticle.name)}</strong>
                <small>${this.escapeHtml(tradeArticle.summary)}</small>
              </span>
            </label>
          ` : ""}
          ${migrationArticle ? `
            <label class="diplomacyTermCard">
              <input type="checkbox" name="migrationPact" data-diplomacy-treaty-term="${MIGRATION_PACT_ARTICLE_ID}" ${migrationTreaty ? "checked" : ""} ${disabled ? "disabled" : ""}>
              <span>
                <strong>${this.escapeHtml(migrationArticle.name)}</strong>
                <small>${this.escapeHtml(migrationArticle.summary)}</small>
              </span>
            </label>
          ` : ""}
        </div>
        <div class="diplomacyTreatySubmitRow">
          <label>
            <span>Duration</span>
            <input type="number" min="${TREATY_MIN_YEARS}" max="${TREATY_MAX_YEARS}" value="${this.treatyYears}" data-diplomacy-treaty-years ${disabled ? "disabled" : ""}>
          </label>
          <button type="submit" data-diplomacy-propose-trade data-disabled="${disabled ? "true" : "false"}" ${disabled ? "disabled" : ""}>
            ${tradeTreaty || migrationTreaty ? "Send Renegotiation" : "Send Treaty"}
          </button>
        </div>
      </form>
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
      : `${proposal.articleIds.map((articleId) => this.articleName(articleId)).join(", ")} treaty`;
    return `
      <div class="diplomacyProposal">
        <span>
          <strong>${this.escapeHtml(label)}</strong>
          <small>${sentByUs ? "Sent to" : "From"} ${this.escapeHtml(other?.name ?? `Faction ${otherId}`)} - ${proposal.durationYears} year${proposal.durationYears === 1 ? "" : "s"}</small>
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
    this.panelElement.querySelector<HTMLInputElement>("[data-diplomacy-country-search]")?.addEventListener("input", (ev) => {
      this.countrySearch = (ev.currentTarget as HTMLInputElement).value;
      this.show(data);
      const input = this.panelElement?.querySelector<HTMLInputElement>("[data-diplomacy-country-search]");
      input?.focus();
      input?.setSelectionRange(this.countrySearch.length, this.countrySearch.length);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-diplomacy-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.diplomacyTab;
        if (tab !== "overview" && tab !== "treaties" && tab !== "chat") return;
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
    const treatyForm = this.panelElement?.querySelector<HTMLFormElement>("[data-diplomacy-treaty-form]");
    const treatyTerms = Array.from(treatyForm?.querySelectorAll<HTMLInputElement>("[data-diplomacy-treaty-term]") ?? []);
    const treatySend = treatyForm?.querySelector<HTMLButtonElement>("[data-diplomacy-propose-trade]");
    const syncTreatySendState = (): void => {
      if (!treatySend) return;
      treatySend.disabled = treatySend.dataset.disabled === "true" || !treatyTerms.some((term) => term.checked);
    };
    treatyTerms.forEach((term) => term.addEventListener("change", syncTreatySendState));
    syncTreatySendState();
    treatyForm?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const target = this.getSelectedCountry(data);
      const articleIds = treatyTerms
        .filter((term) => term.checked)
        .map((term) => term.dataset.diplomacyTreatyTerm)
        .filter((articleId): articleId is typeof TRADE_PRIVILEGE_ARTICLE_ID | typeof MIGRATION_PACT_ARTICLE_ID => (
          articleId === TRADE_PRIVILEGE_ARTICLE_ID || articleId === MIGRATION_PACT_ARTICLE_ID
        ));
      if (!target || articleIds.length === 0) return;
      const durationInput = treatyForm.querySelector<HTMLInputElement>("[data-diplomacy-treaty-years]");
      this.treatyYears = this.clampYears(durationInput?.value ?? this.treatyYears);
      const existing = this.getTreatiesWith(data, target.faction.id)[0];
      data.onDiplomacyCommand?.({
        type: "proposeTreaty",
        targetFactionId: target.faction.id,
        articleIds,
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

  private getFilteredCountries(data: DiplomacyPanelData): DiplomacyCountrySummary[] {
    const query = this.countrySearch.trim().toLowerCase();
    if (!query) return data.countries;
    return data.countries.filter((country) => (
      country.faction.name.toLowerCase().includes(query)
      || this.getCountryStatus(country).toLowerCase().includes(query)
      || this.getCountryAttitude(country).toLowerCase().includes(query)
    ));
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

  private getMessagesWith(data: DiplomacyPanelData, factionId: number): DiplomacyPanelData["chatMessages"] {
    const playerFactionId = data.playerFactionId;
    if (playerFactionId === null) return [];
    return data.chatMessages.filter((message) => (
      (message.fromFactionId === playerFactionId && message.toFactionId === factionId)
      || (message.fromFactionId === factionId && message.toFactionId === playerFactionId)
    ));
  }

  private getEligibleTransfersWith(
    data: DiplomacyPanelData,
    factionId: number,
  ): DiplomacyPanelData["eligiblePeaceTransferSystems"] {
    const playerFactionId = data.playerFactionId;
    if (playerFactionId === null) return [];
    return data.eligiblePeaceTransferSystems.filter((system) => (
      (system.fromFactionId === playerFactionId && system.toFactionId === factionId)
      || (system.fromFactionId === factionId && system.toFactionId === playerFactionId)
    ));
  }

  private getCountryStatus(country: DiplomacyCountrySummary): string {
    if (country.isSelf) return "Our country";
    if (country.atWar) return "Active war";
    if (country.tradePrivilegeActive) return "Trade privilege";
    if (country.migrationPactActive) return "Migration pact";
    if (country.pendingProposalCount > 0) return "Proposal pending";
    return "No active pact";
  }

  private getCountryAttitude(country: DiplomacyCountrySummary): string {
    if (country.isSelf) return "Command";
    if (country.atWar) return "Hostile";
    if ((country.tradePrivilegeActive || country.migrationPactActive) && country.ourBorderPolicy === "open" && country.theirBorderPolicy === "open") return "Friendly";
    if (country.tradePrivilegeActive || country.migrationPactActive || country.theirBorderPolicy === "open") return "Cooperative";
    if (country.pendingProposalCount > 0) return "Cautious";
    return "Neutral";
  }

  private getAttitudeClass(attitude: string): string {
    switch (attitude) {
      case "Hostile":
        return "danger";
      case "Friendly":
      case "Cooperative":
        return "friendly";
      case "Cautious":
        return "warn";
      case "Command":
        return "command";
      default:
        return "neutral";
    }
  }

  private getRelationMeterValue(country: DiplomacyCountrySummary): number {
    if (country.isSelf) return 7;
    if (country.atWar) return 1;
    let score = 3;
    if (country.tradePrivilegeActive) score += 2;
    if (country.migrationPactActive) score += 2;
    if (country.ourBorderPolicy === "open") score += 1;
    if (country.theirBorderPolicy === "open") score += 1;
    if (country.pendingProposalCount > 0) score -= 1;
    return Math.max(1, Math.min(7, score));
  }

  private articleName(articleId: string): string {
    if (articleId === TRADE_PRIVILEGE_ARTICLE_ID) return "Trade Privilege";
    if (articleId === MIGRATION_PACT_ARTICLE_ID) return "Migration Pact";
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

  private escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private escapeAttribute(value: unknown): string {
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
.diplomacyPanel {
  width: min(1320px, calc(100vw - 32px));
  height: min(740px, calc(100vh - 32px));
  background:
    linear-gradient(135deg, rgba(77, 255, 218, 0.14), transparent 22%),
    radial-gradient(circle at 78% 18%, rgba(63, 170, 255, 0.12), transparent 18rem),
    linear-gradient(180deg, rgba(2, 22, 24, 0.98), rgba(1, 8, 12, 0.99));
  border-color: rgba(60, 244, 210, 0.68);
  box-shadow:
    0 28px 84px rgba(0, 0, 0, 0.68),
    0 0 0 1px rgba(52, 255, 213, 0.18),
    inset 0 0 46px rgba(56, 255, 210, 0.08);
}
.diplomacyPanel::before,
.diplomacyPanel::after {
  content: "";
  position: absolute;
  pointer-events: none;
}
.diplomacyPanel::before {
  inset: 8px;
  border: 1px solid rgba(69, 255, 219, 0.2);
  box-shadow: inset 0 0 22px rgba(69, 255, 219, 0.08);
}
.diplomacyPanel::after {
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #4dffda 8%, rgba(88, 183, 255, 0.7) 50%, #4dffda 92%, transparent);
}
.diplomacyHeader {
  position: relative;
  z-index: 1;
  height: 76px;
  padding: 0 18px 0 26px;
  gap: 16px;
  background:
    linear-gradient(105deg, rgba(7, 71, 66, 0.92) 0 34%, rgba(7, 43, 48, 0.74) 34% 100%),
    linear-gradient(180deg, rgba(9, 48, 50, 0.96), rgba(2, 14, 17, 0.94));
  border-bottom-color: rgba(72, 255, 221, 0.34);
}
.diplomacyHeaderIcon {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(94, 255, 229, 0.18) 0 45%, transparent 46%),
    linear-gradient(135deg, #78fff0, #72a8ff);
  color: #021215;
  clip-path: none;
}
.diplomacyHeaderIcon span {
  width: 34px;
  height: 34px;
  border: 3px solid rgba(2, 18, 21, 0.9);
  border-radius: 50%;
  box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.28), inset 0 -8px 0 rgba(2, 18, 21, 0.16);
}
.diplomacyTitle {
  font-size: 27px;
  letter-spacing: 0;
}
.diplomacySubtitle {
  color: rgba(77, 255, 218, 0.7);
  font-size: 12px;
  letter-spacing: 0.12em;
}
.diplomacyClose {
  width: 42px;
  height: 42px;
  font-size: 20px;
  background: rgba(2, 17, 22, 0.72);
}
.diplomacyBody {
  position: relative;
  z-index: 1;
  height: calc(100% - 76px);
  grid-template-columns: 370px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 14px 14px;
}
.diplomacyCountries,
.diplomacyDetail,
.diplomacyCommandCard,
.diplomacyTreatyCard {
  border: 1px solid rgba(78, 255, 219, 0.22);
  background: linear-gradient(180deg, rgba(5, 32, 35, 0.82), rgba(2, 13, 17, 0.88));
  box-shadow: inset 0 0 24px rgba(65, 255, 215, 0.04);
}
.diplomacyCountries {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border-right: 1px solid rgba(78, 255, 219, 0.28);
  padding: 12px;
}
.diplomacySectionTitle {
  padding: 0 0 9px;
}
.diplomacySectionTitle strong,
.diplomacyCardHeader strong,
.diplomacyCardEyebrow {
  color: #76ffdd;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}
.diplomacySectionTitle span {
  color: rgba(118, 255, 221, 0.76);
  font-size: 12px;
}
.diplomacySearchRow {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 38px;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}
.diplomacySearchRow input {
  width: 100%;
}
.diplomacySearchRow button {
  min-height: 34px;
  padding: 0;
}
.diplomacySearchIcon,
.diplomacyFilterIcon {
  position: relative;
  display: grid;
  place-items: center;
  height: 34px;
  border: 1px solid rgba(78, 255, 219, 0.22);
  background: rgba(2, 14, 18, 0.72);
}
.diplomacySearchIcon::before {
  content: "";
  width: 13px;
  height: 13px;
  border: 2px solid rgba(219, 255, 250, 0.68);
  border-radius: 50%;
}
.diplomacySearchIcon::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 2px;
  background: rgba(219, 255, 250, 0.68);
  transform: translate(8px, 8px) rotate(45deg);
}
.diplomacyFilterIcon::before,
.diplomacyFilterIcon::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 2px;
  background: rgba(118, 255, 221, 0.78);
}
.diplomacyFilterIcon::before {
  transform: translateY(-5px);
}
.diplomacyFilterIcon::after {
  width: 10px;
  transform: translateY(5px);
}
.diplomacyCountryList {
  height: auto;
  min-height: 0;
  padding: 0 4px 0 0;
}
.diplomacyCountryRow {
  min-height: 52px;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  margin-bottom: 7px;
  padding: 7px 9px;
  background: linear-gradient(90deg, rgba(14, 61, 56, 0.78), rgba(3, 18, 22, 0.9));
  border-color: rgba(78, 255, 219, 0.22);
}
.diplomacyCountryRow:hover {
  border-color: rgba(118, 255, 221, 0.56);
}
.diplomacyCountryRow.selected {
  border-color: rgba(118, 255, 221, 0.86);
  background:
    linear-gradient(90deg, rgba(26, 103, 83, 0.82), rgba(4, 28, 29, 0.92));
  box-shadow: inset 3px 0 0 #76ffdd, inset 0 0 22px rgba(118, 255, 221, 0.13);
}
.diplomacyFlag {
  width: 34px;
  height: 26px;
}
.diplomacyCountryCopy strong {
  font-size: 14px;
}
.diplomacyCountryCopy small {
  font-size: 11px;
}
.diplomacyCountryBadges em {
  color: #dffef8;
  border: 1px solid rgba(118, 255, 221, 0.28);
  background: rgba(4, 28, 30, 0.82);
}
.diplomacyCountryBadges em.friendly {
  color: #9dff91;
}
.diplomacyCountryBadges em.neutral {
  color: #dce9e6;
}
.diplomacyCountryBadges em.command {
  color: #72a8ff;
}
.diplomacyCountryBadges .danger,
.diplomacyAttitude.danger,
.diplomacyPanel .danger {
  color: #fff1f1;
  background: rgba(122, 24, 30, 0.82);
  border-color: rgba(255, 102, 116, 0.55);
}
.diplomacyCountryBadges .warn,
.diplomacyAttitude.warn {
  color: #ffe89d;
  background: rgba(72, 49, 9, 0.82);
  border-color: rgba(255, 210, 106, 0.56);
}
.diplomacyDetail {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.diplomacyTargetHeader {
  display: grid;
  grid-template-columns: 84px 82px minmax(220px, 1fr) minmax(380px, 0.95fr);
  align-items: center;
  gap: 18px;
  min-height: 148px;
  padding: 18px 22px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--target-color) 16%, transparent), transparent 52%),
    rgba(2, 14, 18, 0.58);
}
.diplomacyTargetFlag {
  width: 68px;
  height: 52px;
  border-radius: 3px;
}
.diplomacyTargetSeal {
  width: 58px;
  height: 58px;
  border: 2px solid color-mix(in srgb, var(--target-color) 66%, rgba(118, 255, 221, 0.4));
  border-radius: 50%;
  background:
    radial-gradient(circle, transparent 0 34%, color-mix(in srgb, var(--target-color) 38%, transparent) 35% 38%, transparent 39%),
    linear-gradient(135deg, transparent 43%, color-mix(in srgb, var(--target-color) 70%, #76ffdd) 44% 56%, transparent 57%);
  opacity: 0.8;
}
.diplomacyTargetIdentity {
  min-width: 0;
}
.diplomacyTargetIdentity strong {
  display: block;
  color: #ffffff;
  font-size: 25px;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diplomacyTargetIdentity small {
  margin-top: 5px;
  font-size: 13px;
}
.diplomacyAttitude {
  display: inline-block;
  margin-top: 14px;
  padding: 3px 10px;
  border: 1px solid rgba(118, 255, 221, 0.34);
  color: #9dff91;
  background: rgba(8, 42, 30, 0.72);
  font-size: 13px;
  font-weight: 900;
}
.diplomacyAttitude.neutral,
.diplomacyAttitude.command {
  color: #dffef8;
}
.diplomacyRelationMeter {
  display: flex;
  gap: 5px;
  margin-top: 12px;
}
.diplomacyRelationMeter i {
  width: 28px;
  height: 8px;
  border: 1px solid rgba(118, 255, 221, 0.28);
  background: rgba(3, 24, 25, 0.8);
}
.diplomacyRelationMeter i.filled {
  background: linear-gradient(90deg, #75ff9b, #76ffdd);
}
.diplomacyTargetMetrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.diplomacyMetric {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 5px;
  padding: 8px;
  border-left: 1px solid rgba(118, 255, 221, 0.14);
}
.diplomacyMetricIcon {
  position: relative;
  width: 30px;
  height: 30px;
}
.diplomacyMetricIcon::before,
.diplomacyMetricIcon::after,
.diplomacyCardIcon::before,
.diplomacyCardIcon::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
}
.diplomacyMetricIcon::before {
  inset: 5px;
  border: 2px solid #76ffdd;
  border-radius: 50%;
}
.diplomacyMetric small {
  color: rgba(219, 255, 250, 0.62);
  font-size: 12px;
}
.diplomacyMetric strong {
  color: #ffffff;
  font-size: 14px;
}
.diplomacyTabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}
.diplomacyTabs button {
  min-height: 36px;
  border-color: rgba(78, 255, 219, 0.22);
  border-bottom-color: rgba(78, 255, 219, 0.34);
  color: rgba(219, 255, 250, 0.7);
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.diplomacyTabs button.active {
  color: #ffffff;
  background: linear-gradient(180deg, rgba(37, 123, 105, 0.72), rgba(6, 33, 35, 0.86));
  border-color: rgba(118, 255, 221, 0.72);
  box-shadow: inset 0 -2px 0 #76ffdd, 0 0 14px rgba(118, 255, 221, 0.18);
}
.diplomacyDetailScroll {
  min-height: 0;
  height: auto;
  padding: 8px;
}
.diplomacyOverviewGrid {
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
}
.diplomacyTreatyLayout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.diplomacyWide {
  grid-column: 1 / -1;
}
.diplomacyCommandCard {
  min-width: 0;
  min-height: 132px;
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 14px;
  padding: 14px;
}
.diplomacyCardIcon {
  position: relative;
  width: 54px;
  height: 54px;
  border: 1px solid rgba(118, 255, 221, 0.24);
  border-radius: 50%;
  background: rgba(5, 42, 43, 0.58);
  box-shadow: inset 0 0 18px rgba(118, 255, 221, 0.08);
}
.diplomacyIcon-border::before {
  inset: 14px;
  border: 2px solid #76ffdd;
  clip-path: polygon(50% 0, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
}
.diplomacyIcon-stance::before {
  width: 28px;
  height: 18px;
  left: 13px;
  top: 16px;
  border: 2px solid #9dff91;
  border-left: 0;
  border-radius: 0 16px 16px 0;
  transform: rotate(-20deg);
}
.diplomacyIcon-war::before {
  width: 30px;
  height: 3px;
  left: 12px;
  top: 26px;
  background: #ff6674;
  transform: rotate(42deg);
}
.diplomacyIcon-war::after {
  width: 30px;
  height: 3px;
  left: 12px;
  top: 26px;
  background: #ff6674;
  transform: rotate(-42deg);
}
.diplomacyIcon-trade::before {
  inset: 14px;
  border: 2px solid #f0d65d;
  transform: rotate(45deg);
}
.diplomacyIcon-treaty::before {
  width: 24px;
  height: 30px;
  left: 16px;
  top: 12px;
  border: 2px solid #76ffdd;
}
.diplomacyIcon-treaty::after {
  width: 14px;
  height: 2px;
  left: 21px;
  top: 22px;
  background: #76ffdd;
  box-shadow: 0 7px 0 #76ffdd;
}
.diplomacyIcon-intel::before {
  width: 34px;
  height: 20px;
  left: 10px;
  top: 17px;
  border: 2px solid #76ffdd;
  border-radius: 50%;
}
.diplomacyIcon-intel::after {
  width: 8px;
  height: 8px;
  left: 27px;
  top: 23px;
  background: #76ffdd;
  border-radius: 50%;
}
.diplomacyCardBody {
  min-width: 0;
}
.diplomacyCardBody p,
.diplomacyTreatyCard p {
  color: rgba(219, 255, 250, 0.68);
  font-size: 12px;
  line-height: 1.45;
}
.diplomacyCardBody strong {
  display: block;
  margin-top: 8px;
  color: #f0d65d;
  font-size: 18px;
}
.diplomacyTwoColumn {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.diplomacyTwoColumn small,
.diplomacyIntelGrid span {
  color: rgba(219, 255, 250, 0.62);
  font-size: 12px;
}
.diplomacyIntelGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.diplomacyIntelGrid span {
  min-width: 0;
  padding: 9px 10px;
  border-left: 1px solid rgba(118, 255, 221, 0.2);
  background: rgba(255, 255, 255, 0.035);
}
.diplomacyIntelGrid strong {
  display: block;
  margin-top: 4px;
  color: #ffffff;
  font-size: 14px;
}
.diplomacyChat {
  min-height: 430px;
}
.diplomacyChatHeader {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #76ffdd;
  font-size: 12px;
  text-transform: uppercase;
}
.diplomacyChatMessages {
  background: rgba(2, 14, 18, 0.72);
}
.diplomacyMessage {
  border-color: rgba(118, 255, 221, 0.18);
  background: rgba(12, 51, 58, 0.78);
}
.diplomacyMessage.own {
  background: rgba(23, 91, 88, 0.84);
}
.diplomacyTreatyCard {
  padding: 14px;
}
.diplomacyProposal {
  border-top-color: rgba(118, 255, 221, 0.14);
}
.diplomacyPanel button,
.diplomacyPanel input,
.diplomacyPanel select {
  border-color: rgba(78, 255, 219, 0.35);
}
.diplomacyPanel button {
  font-weight: 800;
}
.diplomacyPanel {
  --diplomacy-panel-scale: 0.82;
  width: min(1200px, calc(100vw - 32px));
  height: min(680px, calc(100vh - 32px));
  transform: scale(var(--diplomacy-panel-scale));
  transform-origin: top left;
}
.diplomacyHeader {
  height: 58px;
  padding: 0 14px 0 18px;
  gap: 12px;
}
.diplomacyHeaderIcon {
  width: 42px;
  height: 42px;
}
.diplomacyHeaderIcon span {
  width: 25px;
  height: 25px;
  border-width: 2px;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.22), inset 0 -6px 0 rgba(2, 18, 21, 0.16);
}
.diplomacyTitle {
  font-size: 21px;
}
.diplomacySubtitle {
  font-size: 10px;
}
.diplomacyClose {
  width: 34px;
  height: 34px;
  font-size: 17px;
}
.diplomacyBody {
  height: calc(100% - 58px);
  grid-template-columns: 318px minmax(0, 1fr);
  gap: 8px;
  padding: 9px 10px 10px;
}
.diplomacyCountries {
  padding: 9px;
}
.diplomacySearchRow {
  grid-template-columns: 28px minmax(0, 1fr) 34px;
  margin-bottom: 8px;
}
.diplomacySearchIcon,
.diplomacyFilterIcon,
.diplomacySearchRow button {
  height: 31px;
  min-height: 31px;
}
.diplomacyCountryRow {
  min-height: 46px;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 8px;
  margin-bottom: 5px;
  padding: 6px 7px;
}
.diplomacyFlag {
  width: 29px;
  height: 22px;
}
.diplomacyCountryCopy strong {
  font-size: 12px;
}
.diplomacyCountryCopy small,
.diplomacyCountryBadges em {
  font-size: 10px;
}
.diplomacyDetail {
  min-height: 0;
  overflow: hidden;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.diplomacyTargetHeader {
  grid-template-columns: 58px 48px minmax(180px, 1fr) minmax(280px, 0.88fr);
  gap: 12px;
  min-height: 110px;
  padding: 12px 14px;
}
.diplomacyTargetFlag {
  width: 48px;
  height: 37px;
}
.diplomacyTargetSeal {
  width: 43px;
  height: 43px;
}
.diplomacyTargetIdentity strong {
  font-size: 20px;
}
.diplomacyTargetIdentity small,
.diplomacyAttitude,
.diplomacyMetric small {
  font-size: 11px;
}
.diplomacyAttitude {
  margin-top: 8px;
  padding: 2px 8px;
}
.diplomacyRelationMeter {
  gap: 4px;
  margin-top: 8px;
}
.diplomacyRelationMeter i {
  width: 21px;
  height: 6px;
}
.diplomacyTargetMetrics {
  gap: 5px;
}
.diplomacyMetric {
  gap: 4px;
  padding: 5px;
}
.diplomacyMetricIcon {
  width: 24px;
  height: 24px;
}
.diplomacyMetric strong {
  font-size: 12px;
}
.diplomacyTabs {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
}
.diplomacyTabs button {
  min-height: 31px;
  font-size: 11px;
}
.diplomacyDetailScroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 7px;
}
.diplomacyOverviewGrid {
  grid-template-columns: minmax(0, 1.28fr) minmax(0, 1fr);
  gap: 8px;
}
.diplomacyTreatyLayout {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.diplomacyTreatyColumn {
  min-width: 0;
  display: grid;
  gap: 8px;
  align-content: start;
}
.diplomacyCommandCard {
  min-height: 112px;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
}
.diplomacyCardIcon {
  width: 42px;
  height: 42px;
}
.diplomacyCardBody p,
.diplomacyTreatyCard p,
.diplomacyTwoColumn small,
.diplomacyIntelGrid span,
.diplomacyPeaceForm label:not(.diplomacyCheck),
.diplomacyCheck {
  font-size: 11px;
}
.diplomacyCardBody strong {
  margin-top: 6px;
  font-size: 15px;
}
.diplomacyCardEyebrow,
.diplomacySectionTitle strong,
.diplomacyCardHeader strong {
  font-size: 11px;
}
.diplomacyInlineActions,
.diplomacyConfirm,
.diplomacyProposalActions {
  gap: 6px;
}
.diplomacyPanel button,
.diplomacyPanel input,
.diplomacyPanel select {
  min-height: 29px;
  font-size: 11px;
}
.diplomacyPanel button {
  padding: 0 10px;
}
.diplomacyPanel input,
.diplomacyPanel select {
  padding: 0 8px;
}
.diplomacyTwoColumn {
  gap: 12px;
}
.diplomacyIntelGrid {
  gap: 7px;
  margin-top: 8px;
}
.diplomacyIntelGrid span {
  padding: 7px 8px;
}
.diplomacyIntelGrid strong {
  font-size: 12px;
}
.diplomacyTreatyCard {
  padding: 10px;
}
.diplomacyTreatyComposer {
  display: grid;
  gap: 8px;
}
.diplomacyTermGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.diplomacyTermCard {
  min-width: 0;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  padding: 8px;
  color: rgba(230, 255, 252, 0.82);
  background: rgba(2, 14, 18, 0.62);
  border: 1px solid rgba(78, 255, 219, 0.22);
}
.diplomacyTermCard input {
  width: 15px;
  height: 15px;
  min-height: 15px;
  margin: 2px 0 0;
  padding: 0;
}
.diplomacyTermCard strong {
  display: block;
  color: #ffffff;
  font-size: 12px;
}
.diplomacyTermCard small {
  display: block;
  margin-top: 3px;
  color: rgba(219, 255, 250, 0.62);
  font-size: 10px;
  line-height: 1.35;
}
.diplomacyTreatySubmitRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}
.diplomacyTreatySubmitRow label {
  display: grid;
  gap: 4px;
  color: rgba(219, 255, 250, 0.64);
  font-size: 10px;
  text-transform: uppercase;
}
.diplomacyTreatySubmitRow input {
  width: 96px;
}
.diplomacyProposal {
  gap: 8px;
  padding: 8px 0;
}
.diplomacyProposal small,
.diplomacyMessage small {
  font-size: 10px;
  white-space: normal;
}
.diplomacyChat {
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.diplomacyChatHeader {
  font-size: 11px;
}
.diplomacyChatMessages {
  min-height: 0;
  padding: 9px;
}
.diplomacyMessage {
  padding: 7px 9px;
}
.diplomacyMessage span {
  font-size: 12px;
}
.diplomacyEmpty {
  min-height: 120px;
  font-size: 11px;
}
.diplomacyEmpty.compact {
  min-height: 48px;
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
