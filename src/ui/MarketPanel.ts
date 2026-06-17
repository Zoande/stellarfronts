import {
  RESOURCE_KINDS,
  RESOURCE_LABELS,
} from "../data/Economy";
import type { ResourceKind } from "../data/Economy";
import { GAME_DAYS_PER_YEAR } from "../game/GameTime";
import type {
  ClientCommand,
  MarketDetailPayload,
  MarketResourceQuote,
} from "../game/GameProtocol";
import {
  captureScrollState,
  PanelInteractionGate,
  restoreScrollStateSoon,
} from "./panelDomState";
import { ensurePanelThemeStyles } from "./panelTheme";

export interface MarketPanelData extends MarketDetailPayload {
  playerFactionId: number | null;
  factionName?: string;
  onMarketCommand?: (command: ClientCommand) => void;
  onClose?: () => void;
}

const STYLE_ID = "market-panel-style";
const MARKET_SCROLL_SELECTORS = [".marketResourceList", ".marketDetailPanel"] as const;
type MarketGraphRange = "1D" | "7D" | "30D" | "1Y" | "MAX";

const RESOURCE_ICON_URLS: Record<ResourceKind, string> = {
  food: "/textures/resource-icons/nobg/food.webp",
  minerals: "/textures/resource-icons/nobg/minerals.webp",
  energy: "/textures/resource-icons/nobg/energy.webp",
  goods: "/textures/resource-icons/nobg/goods.webp",
  alloys: "/textures/resource-icons/nobg/alloys.webp",
  research: "/textures/resource-icons/nobg/research.webp",
};

export class MarketPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: MarketPanelData | null = null;
  private selectedResourceId: ResourceKind | null = null;
  private buyAmount = 100;
  private sellAmount = 100;
  private autoTradeAmount = 100;
  private graphRange: MarketGraphRange = "30D";
  private position = { x: 36, y: 54 };
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private pendingRefreshData: MarketPanelData | null = null;
  private pendingRefreshTimer: number | null = null;
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
    ensurePanelThemeStyles();
    this.injectStyles();
  }

  public show(data: MarketPanelData): void {
    this.currentData = data;
    this.ensureSelectedResource(data);
    const scrollState = captureScrollState(this.panelElement, MARKET_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "marketPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: MarketPanelData): void {
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

  private render(data: MarketPanelData): string {
    const selected = this.getSelectedResource(data);
    const subtitle = data.factionName ? `${data.factionName} Trade Exchange` : "NIG Trade Exchange";
    const totalExports = data.playerStats?.totalExportsEnergy ?? 0;
    const totalImports = data.playerStats?.totalImportsEnergy ?? 0;
    return `
      <div class="marketHeader" data-market-drag>
        <div class="marketHeaderIcon">M</div>
        <div class="marketHeaderText">
          <div class="marketTitle">Market</div>
          <div class="marketSubtitle">${this.escapeHtml(subtitle)}</div>
        </div>
        <button class="marketClose" type="button" data-market-close aria-label="Close market">X</button>
      </div>
      <section class="marketBody">
        <div class="marketSummary">
          ${this.renderSummaryTile("EX", "Total Exports", this.formatEnergy(totalExports), "Energy")}
          ${this.renderSummaryTile("IM", "Total Imports", this.formatEnergy(totalImports), "Energy")}
          ${this.renderSummaryTile("TR", "Trade Routes", "0", "Placeholder")}
          ${this.renderSummaryTile("%", "Market Fee", this.formatPercent(data.marketFee), "Base fee")}
        </div>
        <div class="marketMain">
          <section class="marketResourcePanel">
            <div class="marketSectionTitle">
              <strong>Resource Market</strong>
              <span>Select a resource to view market details and trade.</span>
            </div>
            <div class="marketResourceList" role="list">
              ${data.resources.length
                ? data.resources.map((resource) => this.renderResourceRow(resource, selected?.resourceId === resource.resourceId)).join("")
                : this.renderResourceEmpty()}
            </div>
          </section>
          <section class="marketDetailPanel">
            ${selected ? this.renderSelectedResource(data, selected) : this.renderNoSelection()}
          </section>
        </div>
      </section>
      <nav class="marketTabs">
        <button class="active" type="button">
          <span class="marketTabBadge" aria-hidden="true">MK</span>
          Market
        </button>
        <button class="disabled" type="button" disabled title="Trade route management is not implemented yet.">
          <span class="marketTabBadge muted" aria-hidden="true">TR</span>
          Trade Routes
        </button>
      </nav>
    `;
  }

  private renderSummaryTile(iconLabel: string, label: string, value: string, caption: string): string {
    return `
      <div class="marketSummaryTile">
        <span class="marketSummaryBadge" aria-hidden="true">${this.escapeHtml(iconLabel)}</span>
        <span>
          <small>${this.escapeHtml(label)}</small>
          <strong>${this.escapeHtml(value)}</strong>
          <em>${this.escapeHtml(caption)}</em>
        </span>
      </div>
    `;
  }

  private renderResourceRow(resource: MarketResourceQuote, selected: boolean): string {
    const status = this.getMarketStatus(resource);
    return `
      <button class="marketResourceRow ${selected ? "selected" : ""} ${resource.marketEnabled ? "" : "disabled"}" type="button" data-market-resource="${this.escapeAttribute(resource.resourceId)}">
        <span class="marketResourceIconSlot">${this.renderResourceIcon(resource.resourceId)}</span>
        <span class="marketResourceCopy">
          <strong>${this.escapeHtml(RESOURCE_LABELS[resource.resourceId])}</strong>
          <small>${resource.marketEnabled ? this.escapeHtml(status.label) : "Trading disabled"}</small>
        </span>
        <span class="marketResourcePrice">
          <small>Price</small>
          <strong>${this.escapeHtml(this.formatPrice(resource.finalQuotePrice))}</strong>
        </span>
      </button>
    `;
  }

  private renderSelectedResource(data: MarketPanelData, resource: MarketResourceQuote): string {
    const status = this.getMarketStatus(resource);
    const disabled = !resource.marketEnabled || !data.onMarketCommand;
    return `
      <div class="marketSelectedHeader">
        <span class="marketSelectedIcon">${this.renderResourceIcon(resource.resourceId, true)}</span>
        <span>
          <strong>${this.escapeHtml(RESOURCE_LABELS[resource.resourceId])} Market Details</strong>
          <small>${resource.marketEnabled ? this.escapeHtml(status.label) : "This resource is visible but not market-enabled yet."}</small>
        </span>
        <em class="marketSelectedTrend ${this.getTrendLabel(resource).className}">${this.escapeHtml(this.getTrendLabel(resource).title)}</em>
      </div>
      <div class="marketDetailGrid">
        <section class="marketQuotePanel">
          <div class="marketPriceStrip">
            ${this.renderPriceBox("Current Price", this.formatPrice(resource.finalQuotePrice), "before fee")}
            ${this.renderPriceBox("Buy Price", this.formatPrice(resource.buyPrice), "with fee")}
            ${this.renderPriceBox("Sell Price", this.formatPrice(resource.sellPrice), "after fee")}
            ${this.renderPriceBox("Owned", this.formatCompact(resource.ownedAmount), RESOURCE_LABELS[resource.resourceId])}
          </div>
        </section>
        <section class="marketGraphPanel">
          <div class="marketPanelHeading">
            <strong>Price History</strong>
            <span>${resource.priceHistory.length >= 2 ? this.escapeHtml(this.graphRange) : "Projected sample"}</span>
          </div>
          ${this.renderPriceGraph(resource)}
          ${this.renderGraphRangeButtons()}
        </section>
        <section class="marketDetailsPanel">
          <div class="marketPanelHeading">
            <strong>Market Details</strong>
            <span>Energy settlement</span>
          </div>
          <div class="marketDetailsGrid">
            ${this.renderDetailMetric("Supply Pressure", this.formatPressure(Math.max(0, -(resource.temporaryPressure + resource.persistentPressure))), "down")}
            ${this.renderDetailMetric("Demand Pressure", this.formatPressure(Math.max(0, resource.temporaryPressure + resource.persistentPressure)), "up")}
            ${this.renderDetailMetric("Internal Supply", `${this.formatCompact(resource.internalSupply)} / h`, "neutral")}
            ${this.renderDetailMetric("Internal Demand", `${this.formatCompact(resource.internalDemand)} / h`, "neutral")}
            ${this.renderDetailMetric("Total Exports", this.formatEnergy(resource.totalExportsEnergy), "good")}
            ${this.renderDetailMetric("Total Imports", this.formatEnergy(resource.totalImportsEnergy), "info")}
            ${this.renderDetailMetric("Market Fee", this.formatPercent(data.marketFee), "neutral")}
            ${this.renderDetailMetric("Trade Routes", "Placeholder", "muted")}
          </div>
        </section>
        <section class="marketTradePanel">
          <div class="marketPanelHeading">
            <strong>Manual Trade</strong>
            <span>Market fee applies</span>
          </div>
          <div class="marketTradeControls">
            ${this.renderTradeBox("buy", "Buy", this.buyAmount, resource.buyPrice, disabled)}
            ${this.renderTradeBox("sell", "Sell", this.sellAmount, resource.sellPrice, disabled)}
          </div>
        </section>
        <section class="marketAutoTradePanel">
          ${this.renderAutoTradePanel(data, resource, disabled)}
        </section>
      </div>
    `;
  }

  private renderTradeBox(
    tradeType: "buy" | "sell",
    label: string,
    amount: number,
    unitPrice: number,
    disabled: boolean,
  ): string {
    const total = Math.max(0, amount) * unitPrice;
    return `
      <div class="marketTradeBox ${tradeType}">
        <div class="marketTradeBoxTitle">
          <span class="marketTradeBadge ${tradeType}" aria-hidden="true">${tradeType === "buy" ? "+" : "-"}</span>
          <strong>${this.escapeHtml(label)}</strong>
          <small>${tradeType === "buy" ? "Costs Energy" : "Pays Energy"}</small>
        </div>
        <label class="marketAmountField">
          <span>Amount</span>
          <input type="number" min="1" step="1" value="${this.escapeAttribute(amount)}" data-market-${tradeType}-amount ${disabled ? "disabled" : ""}>
        </label>
        <div class="marketPresetRow">
          ${[100, 500, 1000].map((preset) => `
            <button type="button" data-market-preset="${preset}" data-market-preset-type="${tradeType}" ${disabled ? "disabled" : ""}>${preset}</button>
          `).join("")}
        </div>
        <div class="marketTradeTotal">
          <span>${tradeType === "buy" ? "Cost" : "Payout"}</span>
          <strong>${this.escapeHtml(this.formatEnergy(total))}</strong>
        </div>
        <button class="marketTradeButton" type="button" data-market-trade="${tradeType}" ${disabled ? "disabled" : ""}>
          <span class="marketTradeBadge ${tradeType}" aria-hidden="true">${tradeType === "buy" ? "+" : "-"}</span>
          ${this.escapeHtml(label)}
        </button>
      </div>
    `;
  }

  private renderPriceBox(label: string, value: string, caption: string): string {
    return `
      <div class="marketPriceBox">
        <small>${this.escapeHtml(label)}</small>
        <strong>${this.escapeHtml(value)}</strong>
        <span>${this.escapeHtml(caption)}</span>
      </div>
    `;
  }

  private renderDetailMetric(label: string, value: string, tone: "up" | "down" | "good" | "info" | "neutral" | "muted"): string {
    return `
      <div class="marketDetailMetric ${tone}">
        <small>${this.escapeHtml(label)}</small>
        <strong>${this.escapeHtml(value)}</strong>
      </div>
    `;
  }

  private renderPriceGraph(resource: MarketResourceQuote): string {
    const points = this.getGraphPoints(resource);
    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const width = 500;
    const height = 172;
    const padTop = 14;
    const padBottom = 14;
    // Pad the value axis so a (near-)flat series renders centered instead of
    // collapsing to the bottom edge.
    let lo = min;
    let hi = max;
    const minSpan = Math.max(0.01, Math.abs(max) * 0.04);
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const span = Math.max(0.000001, hi - lo);
    // Position points along the time axis so range filters reflect real spacing.
    const tMin = points[0]?.timestamp ?? 0;
    const tMax = points[points.length - 1]?.timestamp ?? tMin;
    const tSpan = Math.max(0.000001, tMax - tMin);
    const plotX = (point: { timestamp: number }, index: number): number =>
      points.length <= 1 ? width : ((point.timestamp - tMin) / tSpan) * width;
    const plotY = (price: number): number =>
      height - padBottom - ((price - lo) / span) * (height - padTop - padBottom);
    const path = points.map((point, index) => `${plotX(point, index).toFixed(1)},${plotY(point.price).toFixed(1)}`).join(" ");
    const fillPath = points.length > 0 ? `0,${height} ${path} ${width},${height}` : "";
    const last = points[points.length - 1]?.price ?? resource.finalQuotePrice;
    return `
      <div class="marketGraph">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${this.escapeAttribute(RESOURCE_LABELS[resource.resourceId])} price history">
          <g class="marketGraphGrid">
            <line x1="0" y1="43" x2="${width}" y2="43"></line>
            <line x1="0" y1="86" x2="${width}" y2="86"></line>
            <line x1="0" y1="129" x2="${width}" y2="129"></line>
            <line x1="100" y1="0" x2="100" y2="${height}"></line>
            <line x1="250" y1="0" x2="250" y2="${height}"></line>
            <line x1="400" y1="0" x2="400" y2="${height}"></line>
          </g>
          <polygon class="marketGraphFill" points="${this.escapeAttribute(fillPath)}"></polygon>
          <polyline class="marketGraphLine" points="${this.escapeAttribute(path)}" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
        </svg>
        <span class="marketGraphValue">${this.escapeHtml(this.formatPrice(last))}</span>
        <div class="marketGraphScale">
          <span>${this.escapeHtml(this.formatPrice(max))}</span>
          <span>${this.escapeHtml(this.formatPrice(min))}</span>
        </div>
      </div>
    `;
  }

  private renderGraphRangeButtons(): string {
    const ranges: MarketGraphRange[] = ["1D", "7D", "30D", "1Y", "MAX"];
    return `
      <div class="marketGraphRanges" aria-label="Price history range">
        ${ranges.map((range) => `
          <button type="button" class="${this.graphRange === range ? "active" : ""}" data-market-graph-range="${this.escapeAttribute(range)}">${this.escapeHtml(range)}</button>
        `).join("")}
      </div>
    `;
  }

  private renderAutoTradePanel(data: MarketPanelData, resource: MarketResourceQuote, disabled: boolean): string {
    const orders = data.autoTrades.filter((order) => order.resourceId === resource.resourceId);
    return `
      <div class="marketPanelHeading">
        <strong>Automatic Trades</strong>
        <span>Amount per game hour</span>
      </div>
      <div class="marketAutoTradeComposer">
        <label class="marketAmountField">
          <span>Amount / h</span>
          <input type="number" min="1" step="1" value="${this.escapeAttribute(this.autoTradeAmount)}" data-market-auto-amount title="Runs once per game hour. At normal speed, one game hour is one real second." ${disabled ? "disabled" : ""}>
        </label>
        <button type="button" data-market-auto-add="auto_buy" title="Add or update an automatic buy order for this resource." ${disabled ? "disabled" : ""}>Add Buy</button>
        <button type="button" data-market-auto-add="auto_sell" title="Add or update an automatic sell order for this resource." ${disabled ? "disabled" : ""}>Add Sell</button>
      </div>
      <div class="marketAutoTradeList">
        ${orders.length
          ? orders.map((order) => `
            <div class="marketAutoTradeRow ${order.type === "auto_buy" ? "buy" : "sell"}">
              <span>
                <strong>${order.type === "auto_buy" ? "Buy" : "Sell"}</strong>
                <small>${this.escapeHtml(this.formatCompact(order.amountPerHour))} ${this.escapeHtml(RESOURCE_LABELS[order.resourceId])} / game hour</small>
              </span>
              <button type="button" data-market-auto-remove="${this.escapeAttribute(order.id)}" title="Remove this automatic trade.">Remove</button>
            </div>
          `).join("")
          : `<div class="marketAutoTradeEmpty">No automatic trades for ${this.escapeHtml(RESOURCE_LABELS[resource.resourceId])}.</div>`}
      </div>
    `;
  }

  private renderResourceIcon(resource: ResourceKind, large = false): string {
    if (!RESOURCE_KINDS.includes(resource)) {
      return `<span class="marketResourceIcon marketResourceIcon-placeholder ${large ? "large" : ""}" aria-hidden="true"><span>??</span></span>`;
    }
    const iconUrl = RESOURCE_ICON_URLS[resource];
    return `<span class="marketResourceIcon marketResourceIcon-image ${large ? "large" : ""}" title="${this.escapeAttribute(RESOURCE_LABELS[resource])}" aria-hidden="true"><img src="${iconUrl}" alt="" loading="eager" decoding="async" /></span>`;
  }

  private renderResourceEmpty(): string {
    return `
      <div class="marketEmpty">
        <span class="marketResourceIcon marketResourceIcon-placeholder large" aria-hidden="true"></span>
        <strong>No market resources available.</strong>
      </div>
    `;
  }

  private renderNoSelection(): string {
    return `
      <div class="marketEmpty detail">
        <span class="marketResourceIcon marketResourceIcon-placeholder large" aria-hidden="true"></span>
        <strong>Select a resource.</strong>
      </div>
    `;
  }

  private bindEvents(data: MarketPanelData): void {
    if (!this.panelElement) return;

    this.panelElement.querySelector<HTMLButtonElement>("[data-market-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-market-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement || ev.target instanceof HTMLElement && ev.target.closest("button, input, select")) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-resource]").forEach((button) => {
      button.addEventListener("click", () => {
        const resourceId = button.dataset.marketResource as ResourceKind | undefined;
        if (!resourceId || !RESOURCE_KINDS.includes(resourceId)) return;
        this.selectedResourceId = resourceId;
        this.show(data);
      });
    });

    this.panelElement.querySelector<HTMLInputElement>("[data-market-buy-amount]")?.addEventListener("input", (ev) => {
      this.buyAmount = this.normalizeAmount((ev.currentTarget as HTMLInputElement).value, this.buyAmount);
    });
    this.panelElement.querySelector<HTMLInputElement>("[data-market-sell-amount]")?.addEventListener("input", (ev) => {
      this.sellAmount = this.normalizeAmount((ev.currentTarget as HTMLInputElement).value, this.sellAmount);
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const amount = this.normalizeAmount(button.dataset.marketPreset, 100);
        if (button.dataset.marketPresetType === "buy") this.buyAmount = amount;
        if (button.dataset.marketPresetType === "sell") this.sellAmount = amount;
        this.show(data);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-graph-range]").forEach((button) => {
      button.addEventListener("click", () => {
        const range = button.dataset.marketGraphRange as MarketGraphRange | undefined;
        if (!range || !this.isGraphRange(range)) return;
        this.graphRange = range;
        this.show(data);
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-trade]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = this.getSelectedResource(data);
        if (!selected || !data.onMarketCommand || !selected.marketEnabled) return;
        const tradeType = button.dataset.marketTrade === "sell" ? "sell" : "buy";
        const input = this.panelElement?.querySelector<HTMLInputElement>(`[data-market-${tradeType}-amount]`);
        const amount = this.normalizeAmount(input?.value, tradeType === "buy" ? this.buyAmount : this.sellAmount);
        if (tradeType === "buy") this.buyAmount = amount;
        if (tradeType === "sell") this.sellAmount = amount;
        data.onMarketCommand({
          type: "marketTrade",
          resourceId: selected.resourceId,
          tradeType,
          amount,
        });
      });
    });

    this.panelElement.querySelector<HTMLInputElement>("[data-market-auto-amount]")?.addEventListener("input", (ev) => {
      this.autoTradeAmount = this.normalizeAmount((ev.currentTarget as HTMLInputElement).value, this.autoTradeAmount);
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-auto-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = this.getSelectedResource(data);
        if (!selected || !data.onMarketCommand || !selected.marketEnabled) return;
        const tradeType = button.dataset.marketAutoAdd === "auto_sell" ? "auto_sell" : "auto_buy";
        const input = this.panelElement?.querySelector<HTMLInputElement>("[data-market-auto-amount]");
        const amountPerHour = this.normalizeAmount(input?.value, this.autoTradeAmount);
        this.autoTradeAmount = amountPerHour;
        data.onMarketCommand({
          type: "addMarketAutoTrade",
          resourceId: selected.resourceId,
          tradeType,
          amountPerHour,
        });
      });
    });

    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-market-auto-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!data.onMarketCommand) return;
        const orderId = button.dataset.marketAutoRemove;
        if (!orderId) return;
        data.onMarketCommand({
          type: "removeMarketAutoTrade",
          orderId,
        });
      });
    });
  }

  private getSelectedResource(data: MarketPanelData): MarketResourceQuote | null {
    this.ensureSelectedResource(data);
    return data.resources.find((resource) => resource.resourceId === this.selectedResourceId) ?? data.resources[0] ?? null;
  }

  private ensureSelectedResource(data: MarketPanelData): void {
    if (this.selectedResourceId && data.resources.some((resource) => resource.resourceId === this.selectedResourceId)) return;
    this.selectedResourceId = data.resources.find((resource) => resource.marketEnabled)?.resourceId
      ?? data.resources[0]?.resourceId
      ?? null;
  }

  private getGraphPoints(resource: MarketResourceQuote): Array<{ timestamp: number; price: number }> {
    const history = resource.priceHistory
      .filter((snapshot) => Number.isFinite(snapshot.price))
      .map((snapshot) => ({ timestamp: snapshot.timestamp, price: snapshot.price }))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (history.length >= 2) {
      const latestTimestamp = history[history.length - 1]?.timestamp ?? 0;
      const rangeYears = this.getGraphRangeYears();
      const ranged = rangeYears === null
        ? history
        : history.filter((snapshot) => snapshot.timestamp >= latestTimestamp - rangeYears);
      return (ranged.length >= 2 ? ranged : history.slice(-2)).slice(-80);
    }

    const seed = RESOURCE_KINDS.indexOf(resource.resourceId) + 1;
    const base = resource.finalQuotePrice || resource.currentPrice || resource.basePrice;
    return Array.from({ length: 32 }, (_, index) => {
      const wave = Math.sin(index * 0.58 + seed) * 0.045;
      const slope = (index / 31 - 0.5) * 0.08 * (resource.trend === "down" ? -1 : 1);
      const pressure = clamp01(Math.abs(resource.temporaryPressure + resource.persistentPressure)) * 0.08;
      return {
        timestamp: index,
        price: Math.max(0.000001, base * (1 + wave + slope + pressure)),
      };
    });
  }

  private getGraphRangeYears(): number | null {
    if (this.graphRange === "MAX") return null;
    if (this.graphRange === "1D") return 1 / GAME_DAYS_PER_YEAR;
    if (this.graphRange === "7D") return 7 / GAME_DAYS_PER_YEAR;
    if (this.graphRange === "30D") return 30 / GAME_DAYS_PER_YEAR;
    return 1;
  }

  private isGraphRange(value: string): value is MarketGraphRange {
    return value === "1D" || value === "7D" || value === "30D" || value === "1Y" || value === "MAX";
  }

  private getMarketStatus(resource: MarketResourceQuote): { label: string; className: string } {
    const pressure = resource.temporaryPressure + resource.persistentPressure;
    if (pressure > 0.08) return { label: "High demand", className: "demand" };
    if (pressure < -0.08) return { label: "High supply", className: "supply" };
    return { label: "Balanced", className: "balanced" };
  }

  private getTrendLabel(resource: MarketResourceQuote): { title: string; className: string } {
    if (resource.trend === "up") return { title: "Rising", className: "up" };
    if (resource.trend === "down") return { title: "Falling", className: "down" };
    return { title: "Flat", className: "flat" };
  }

  private normalizeAmount(value: unknown, fallback: number): number {
    const next = Math.floor(Number(value));
    return Number.isFinite(next) && next > 0 ? Math.min(1_000_000, next) : fallback;
  }

  private shouldDeferRefresh(): boolean {
    return this.isDragging || this.interactionGate.isBusy(this.panelElement);
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

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private formatPrice(value: number): string {
    return `${this.formatCompact(value)} E`;
  }

  private formatEnergy(value: number): string {
    return `${this.formatCompact(value)} E`;
  }

  private formatPercent(value: number): string {
    return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
  }

  private formatPressure(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  private formatCompact(value: number): string {
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `${sign}${abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}`;
  }

  private escapeHtml(value: unknown): string {
    return String(value)
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
.marketPanel {
  --market-accent: rgba(40, 240, 232, 0.96);
  --panel-accent: var(--market-accent);
  --market-warning: #ffcf4a;
  --market-panel-scale: 0.82;
  position: fixed;
  z-index: 60;
  width: min(1340px, calc(100vw - 32px));
  height: min(730px, calc(100vh - 28px));
  transform: scale(var(--market-panel-scale));
  transform-origin: top left;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 74px minmax(0, 1fr) 58px;
  overflow: hidden;
  color: #eafffa;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  background:
    radial-gradient(circle at 70% 18%, color-mix(in srgb, var(--panel-accent) 12%, transparent), transparent 20rem),
    linear-gradient(180deg, rgba(7, 20, 24, 0.985), rgba(2, 9, 12, 0.99));
  border: 1px solid color-mix(in srgb, var(--panel-accent) 76%, transparent);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  user-select: none;
}

.marketPanel::before,
.marketPanel::after {
  content: "";
  position: absolute;
  z-index: 5;
  pointer-events: none;
}

.marketPanel::before {
  inset: 0;
  border: 1px solid rgba(80, 255, 237, 0.12);
  clip-path: polygon(0 24px, 24px 0, 39% 0, 40% 6px, 64% 6px, 65% 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);
}

.marketPanel::after {
  left: 16px;
  right: 16px;
  top: 72px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(71, 255, 239, 0.7), transparent);
}

.marketHeader {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px 10px;
  cursor: grab;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 22%, rgba(6, 20, 23, 0.92)),
    rgba(3, 11, 14, 0.94));
  border-bottom: 1px solid color-mix(in srgb, var(--panel-accent) 28%, transparent);
}

.marketHeaderIcon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: linear-gradient(135deg, #57f5ff, #00b4d8);
  color: #00151c;
  font-size: 22px;
  font-weight: 950;
  box-shadow: 0 0 24px rgba(49, 232, 255, 0.36), inset 0 0 0 2px rgba(5, 25, 31, 0.36);
}

.marketHeaderText {
  min-width: 0;
}

.marketTitle {
  color: #f1fffb;
  font-size: 30px;
  font-weight: 950;
  line-height: 1;
  letter-spacing: 0;
}

.marketSubtitle {
  margin-top: 5px;
  color: rgba(211, 238, 233, 0.74);
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.marketClose {
  margin-left: auto;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(98, 255, 228, 0.56);
  background: rgba(6, 43, 43, 0.72);
  color: #bffff4;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.marketClose:hover {
  color: #ffffff;
  border-color: rgba(141, 255, 236, 0.9);
  background: rgba(10, 65, 61, 0.84);
}

.marketBody {
  min-height: 0;
  display: grid;
  grid-template-rows: 70px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 14px 0;
}

.marketSummary {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.marketSummaryTile {
  min-width: 0;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 13px;
  border: 1px solid rgba(70, 225, 211, 0.32);
  background:
    linear-gradient(90deg, rgba(6, 46, 48, 0.72), rgba(2, 20, 25, 0.82)),
    linear-gradient(180deg, rgba(94, 255, 232, 0.03), transparent);
}

.marketSummaryTile span:last-child {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.marketSummaryTile small,
.marketSummaryTile em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketSummaryTile small {
  color: rgba(209, 236, 231, 0.72);
  font-size: 11px;
  font-weight: 850;
}

.marketSummaryTile strong {
  color: #f4fffb;
  font-size: 20px;
  font-weight: 950;
  line-height: 1;
}

.marketSummaryTile em {
  color: rgba(163, 238, 226, 0.64);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  text-transform: uppercase;
}

.marketSummaryBadge {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(69, 245, 231, 0.46);
  background:
    radial-gradient(circle at 50% 35%, rgba(99, 255, 238, 0.18), transparent 72%),
    rgba(3, 32, 37, 0.86);
  color: #31f4e9;
  font-size: 12px;
  font-weight: 950;
  letter-spacing: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 0 14px rgba(36, 229, 219, 0.12);
}

.marketSelectedTrend::before {
  content: "";
  position: absolute;
  box-sizing: border-box;
}

.marketMain {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(470px, 1.05fr) minmax(430px, 0.95fr);
  gap: 10px;
}

.marketResourcePanel,
.marketDetailPanel,
.marketQuotePanel,
.marketTradePanel,
.marketAutoTradePanel,
.marketGraphPanel,
.marketDetailsPanel {
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(70, 225, 211, 0.32);
  background:
    linear-gradient(180deg, rgba(4, 28, 32, 0.94), rgba(2, 14, 18, 0.96)),
    repeating-linear-gradient(90deg, rgba(75, 255, 231, 0.04) 0 1px, transparent 1px 96px);
}

.marketResourcePanel {
  display: grid;
  grid-template-rows: 66px minmax(0, 1fr);
  overflow: hidden;
}

.marketSectionTitle,
.marketPanelHeading {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
}

.marketSectionTitle {
  padding: 15px 18px 10px;
  border-bottom: 1px solid rgba(70, 225, 211, 0.22);
}

.marketSectionTitle strong,
.marketPanelHeading strong {
  color: #effefa;
  font-size: 17px;
  font-weight: 950;
  text-transform: uppercase;
}

.marketSectionTitle span,
.marketPanelHeading span {
  min-width: 0;
  color: rgba(203, 233, 227, 0.66);
  font-size: 11px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketResourceList {
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 8px;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(72, 238, 217, 0.58) rgba(0, 0, 0, 0.26);
}

.marketResourceRow {
  min-width: 0;
  min-height: 116px;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px 10px;
  padding: 13px 14px;
  border: 1px solid rgba(64, 222, 214, 0.34);
  background:
    linear-gradient(90deg, rgba(8, 55, 55, 0.62), rgba(3, 21, 26, 0.82)),
    linear-gradient(180deg, rgba(98, 255, 229, 0.03), transparent);
  color: #eafffa;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.marketResourceRow:hover {
  border-color: rgba(86, 255, 235, 0.72);
  background:
    radial-gradient(circle at 10% 50%, rgba(42, 238, 232, 0.13), transparent 9rem),
    linear-gradient(90deg, rgba(8, 63, 61, 0.76), rgba(3, 24, 29, 0.88));
}

.marketResourceRow.selected {
  border-color: rgba(255, 211, 72, 0.92);
  box-shadow: 0 0 18px rgba(255, 203, 51, 0.22), inset 0 0 0 1px rgba(255, 211, 72, 0.24);
}

.marketResourceRow.disabled {
  opacity: 0.63;
}

.marketResourceIconSlot,
.marketSelectedIcon {
  position: relative;
  display: grid;
  place-items: center;
}

.marketResourceIconSlot {
  width: 52px;
  height: 52px;
  background: rgba(7, 37, 42, 0.7);
  border: 1px solid rgba(83, 237, 222, 0.32);
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
}

.marketResourceCopy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.marketResourceCopy strong {
  min-width: 0;
  color: #f2fffb;
  font-size: 18px;
  font-weight: 950;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketResourceCopy small,
.marketResourcePrice small {
  color: rgba(205, 235, 229, 0.68);
  font-size: 11px;
  font-weight: 800;
}

.marketResourcePrice {
  grid-column: 1 / -1;
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  justify-items: start;
  gap: 4px;
  padding-top: 11px;
  border-top: 1px solid rgba(62, 219, 210, 0.22);
}

.marketResourcePrice strong {
  justify-self: end;
  color: #aaf86b;
  font-size: 18px;
  font-weight: 950;
}

.marketDetailPanel {
  min-height: 0;
  display: block;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(72, 238, 217, 0.58) rgba(0, 0, 0, 0.26);
}

.marketSelectedHeader {
  min-height: 86px;
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(70, 225, 211, 0.28);
  background: linear-gradient(90deg, rgba(4, 38, 43, 0.78), rgba(2, 18, 24, 0.84));
}

.marketSelectedIcon {
  width: 62px;
  height: 62px;
  background: rgba(7, 37, 42, 0.7);
  border: 1px solid rgba(83, 237, 222, 0.38);
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
}

.marketSelectedHeader span:nth-child(2) {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.marketSelectedHeader strong {
  min-width: 0;
  color: #f2fffb;
  font-size: 18px;
  font-weight: 950;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketSelectedHeader small {
  min-width: 0;
  color: rgba(207, 237, 231, 0.67);
  font-size: 12px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketSelectedTrend {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #a8ff72;
  font-size: 14px;
  font-style: normal;
  font-weight: 950;
}

.marketSelectedTrend::before {
  position: relative;
  display: inline-block;
  width: 13px;
  height: 13px;
  border-top: 3px solid currentColor;
  border-right: 3px solid currentColor;
  transform: rotate(-45deg);
}

.marketSelectedTrend.down {
  color: #ff6969;
}

.marketSelectedTrend.down::before {
  transform: rotate(135deg);
}

.marketSelectedTrend.flat {
  color: #78dcec;
}

.marketSelectedTrend.flat::before {
  transform: rotate(45deg);
}

.marketDetailGrid {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 246px auto auto auto;
  gap: 10px;
  padding: 10px;
  overflow: visible;
}

.marketQuotePanel,
.marketTradePanel,
.marketAutoTradePanel {
  padding: 10px;
  display: grid;
  gap: 10px;
}

.marketQuotePanel {
  align-content: start;
}

.marketPriceStrip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.marketPriceBox {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(70, 225, 211, 0.24);
  background: rgba(4, 31, 35, 0.7);
}

.marketPriceBox small,
.marketPriceBox span {
  min-width: 0;
  color: rgba(207, 237, 231, 0.66);
  font-size: 10px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketPriceBox strong {
  color: #ffce52;
  font-size: 18px;
  font-weight: 950;
}

.marketTradeControls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.marketTradeBox {
  min-width: 0;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 8px 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(70, 225, 211, 0.26);
  background: rgba(3, 24, 29, 0.72);
}

.marketTradeBox.sell {
  border-color: rgba(255, 86, 86, 0.36);
}

.marketTradeBoxTitle {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  grid-column: 1 / -1;
}

.marketTradeBoxTitle strong {
  color: #3af2ed;
  font-size: 16px;
  font-weight: 950;
  text-transform: uppercase;
}

.marketTradeBox.sell .marketTradeBoxTitle strong {
  color: #ff6767;
}

.marketTradeBoxTitle small {
  color: rgba(204, 234, 228, 0.68);
  font-size: 11px;
  font-weight: 800;
}

.marketAmountField {
  min-width: 0;
  height: 38px;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: center;
  border: 1px solid rgba(74, 219, 201, 0.28);
  background: rgba(0, 14, 18, 0.62);
}

.marketAmountField span {
  display: grid;
  place-items: center;
  height: 100%;
  color: rgba(197, 229, 222, 0.66);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  border-right: 1px solid rgba(74, 219, 201, 0.22);
}

.marketAmountField input {
  min-width: 0;
  width: 100%;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: #eafff8;
  font: inherit;
  font-size: 14px;
  font-weight: 900;
  padding: 0 10px;
}

.marketPresetRow {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.marketPresetRow button,
.marketTradeButton {
  min-width: 0;
  height: 36px;
  border: 1px solid rgba(56, 236, 223, 0.48);
  background: rgba(7, 42, 44, 0.84);
  color: #dcfffa;
  font: inherit;
  font-size: 12px;
  font-weight: 950;
  cursor: pointer;
}

.marketPresetRow button:hover,
.marketTradeButton:hover {
  border-color: rgba(108, 255, 237, 0.82);
  background: rgba(8, 60, 59, 0.9);
}

.marketTradeBox.sell .marketPresetRow button,
.marketTradeBox.sell .marketTradeButton {
  border-color: rgba(255, 92, 92, 0.5);
  background: rgba(64, 16, 18, 0.8);
}

.marketTradeTotal {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.marketTradeTotal span {
  color: rgba(205, 234, 229, 0.64);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.marketTradeTotal strong {
  color: #aaf86b;
  font-size: 15px;
  font-weight: 950;
}

.marketTradeButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 42px;
  font-size: 14px;
  text-transform: uppercase;
}

.marketTradeButton:disabled,
.marketPresetRow button:disabled,
.marketAmountField input:disabled {
  opacity: 0.48;
  cursor: default;
}

.marketTradeBadge,
.marketTabBadge {
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  border: 1px solid currentColor;
  background: rgba(3, 36, 40, 0.74);
  color: currentColor;
  font-size: 12px;
  font-weight: 950;
  line-height: 1;
}

.marketTradeBadge.sell {
  color: #ff6767;
}

.marketTabBadge {
  width: 30px;
  height: 30px;
  color: #36f2e9;
  background: rgba(4, 47, 50, 0.78);
}

.marketTabBadge.muted {
  color: rgba(205, 236, 230, 0.58);
}

.marketGraphPanel,
.marketDetailsPanel {
  padding: 12px;
  display: grid;
  grid-template-rows: 28px minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
}

.marketGraphPanel {
  grid-template-rows: 28px minmax(0, 1fr) 32px;
}

.marketGraph {
  min-height: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(70, 225, 211, 0.2);
  background:
    linear-gradient(180deg, rgba(4, 29, 34, 0.74), rgba(2, 17, 22, 0.86)),
    repeating-linear-gradient(90deg, rgba(57, 210, 215, 0.04) 0 1px, transparent 1px 72px);
}

.marketGraph svg {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: block;
}

.marketGraphGrid line {
  stroke: color-mix(in srgb, var(--panel-accent, #41e2da) 16%, transparent);
  stroke-width: 1;
}

.marketGraphLine {
  stroke: var(--panel-accent, #27f5ef);
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--panel-accent, #27f5ef) 55%, transparent));
}

.marketGraphFill {
  fill: color-mix(in srgb, var(--panel-accent, #27f5ef) 18%, transparent);
}

.marketGraphValue {
  position: absolute;
  right: 12px;
  top: 12px;
  padding: 4px 8px;
  border: 1px solid rgba(46, 244, 235, 0.44);
  background: rgba(4, 48, 52, 0.82);
  color: #dffff9;
  font-size: 12px;
  font-weight: 950;
}

.marketGraphScale {
  position: absolute;
  left: 10px;
  top: 10px;
  bottom: 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: rgba(210, 240, 234, 0.52);
  font-size: 10px;
  font-weight: 800;
}

.marketGraphRanges {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.marketGraphRanges button {
  min-width: 0;
  height: 30px;
  border: 1px solid rgba(68, 218, 207, 0.34);
  background: rgba(3, 26, 30, 0.72);
  color: rgba(215, 243, 238, 0.7);
  font: inherit;
  font-size: 11px;
  font-weight: 950;
  cursor: pointer;
}

.marketGraphRanges button:hover {
  border-color: rgba(94, 248, 231, 0.72);
  color: #effefa;
  background: rgba(5, 46, 47, 0.82);
}

.marketGraphRanges button.active {
  border-color: rgba(255, 211, 72, 0.86);
  color: #fff3b1;
  background:
    linear-gradient(180deg, rgba(255, 211, 72, 0.18), rgba(5, 36, 38, 0.82)),
    rgba(3, 26, 30, 0.78);
}

.marketDetailsGrid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.marketDetailMetric {
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid rgba(70, 225, 211, 0.22);
  background: rgba(4, 30, 34, 0.7);
}

.marketDetailMetric small,
.marketDetailMetric strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketDetailMetric small {
  color: rgba(205, 235, 229, 0.64);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.marketDetailMetric strong {
  color: #eafffa;
  font-size: 14px;
  font-weight: 950;
}

.marketDetailMetric.up strong { color: #a8ff74; }
.marketDetailMetric.down strong { color: #ff7070; }
.marketDetailMetric.good strong { color: #d9f76e; }
.marketDetailMetric.info strong { color: #32d4ff; }
.marketDetailMetric.muted strong { color: rgba(218, 241, 236, 0.58); }

.marketAutoTradePanel {
  align-content: start;
}

.marketAutoTradeComposer {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(170px, 1fr) 104px 104px;
  gap: 8px;
  align-items: center;
}

.marketAutoTradeComposer button,
.marketAutoTradeRow button {
  min-width: 0;
  height: 38px;
  border: 1px solid rgba(68, 218, 207, 0.42);
  background: rgba(5, 38, 42, 0.82);
  color: #dffff9;
  font: inherit;
  font-size: 12px;
  font-weight: 950;
  cursor: pointer;
}

.marketAutoTradeComposer button:hover,
.marketAutoTradeRow button:hover {
  border-color: rgba(94, 248, 231, 0.72);
  background: rgba(6, 53, 53, 0.88);
}

.marketAutoTradeComposer button[data-market-auto-add="auto_buy"] {
  color: #aaff74;
}

.marketAutoTradeComposer button[data-market-auto-add="auto_sell"],
.marketAutoTradeRow.sell button {
  color: #ff7777;
}

.marketAutoTradeComposer button:disabled {
  opacity: 0.48;
  cursor: default;
}

.marketAutoTradeList {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.marketAutoTradeRow {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(70, 225, 211, 0.22);
  background: rgba(4, 30, 34, 0.7);
}

.marketAutoTradeRow.buy {
  border-left: 3px solid rgba(166, 255, 105, 0.76);
}

.marketAutoTradeRow.sell {
  border-left: 3px solid rgba(255, 103, 103, 0.76);
}

.marketAutoTradeRow span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.marketAutoTradeRow strong,
.marketAutoTradeRow small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketAutoTradeRow strong {
  color: #effefa;
  font-size: 13px;
  font-weight: 950;
}

.marketAutoTradeRow small,
.marketAutoTradeEmpty {
  color: rgba(205, 235, 229, 0.66);
  font-size: 11px;
  font-weight: 800;
}

.marketAutoTradeEmpty {
  padding: 10px;
  border: 1px solid rgba(70, 225, 211, 0.18);
  background: rgba(4, 30, 34, 0.52);
}

.marketTabs {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.72fr);
  gap: 8px;
  padding: 8px 0 0;
}

.marketTabs button {
  min-width: 0;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid rgba(76, 223, 197, 0.32);
  background: rgba(3, 26, 29, 0.72);
  color: rgba(205, 236, 230, 0.72);
  font: inherit;
  font-size: 16px;
  font-weight: 950;
  cursor: pointer;
}

.marketTabs button.active {
  color: #eafff8;
  border-color: rgba(71, 241, 220, 0.76);
  background:
    radial-gradient(circle at 50% 100%, rgba(42, 240, 232, 0.24), transparent 13rem),
    rgba(7, 56, 55, 0.82);
}

.marketTabs button.disabled {
  opacity: 0.42;
  cursor: default;
}

.marketEmpty {
  min-height: 260px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: rgba(211, 240, 235, 0.62);
}

.marketEmpty.detail {
  height: 100%;
}

.marketEmpty strong {
  font-size: 15px;
}

.marketResourceIcon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #d9fffb;
  filter: drop-shadow(0 0 8px rgba(50, 255, 225, 0.16));
}

.marketResourceIcon.large {
  width: 54px;
  height: 54px;
}

.marketResourceIcon::before {
  content: "";
  position: absolute;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(145, 241, 229, 0.42);
  background:
    linear-gradient(135deg, rgba(69, 245, 231, 0.12), rgba(255, 255, 255, 0.02)),
    rgba(3, 22, 27, 0.78);
}

.marketResourceIcon-image::before {
  content: none;
}

.marketResourceIcon-image img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.marketResourceIcon span {
  position: relative;
  z-index: 1;
  color: rgba(228, 255, 251, 0.88);
  font-size: 10px;
  font-weight: 950;
  letter-spacing: 0;
}

.marketResourceIcon.large span {
  font-size: 13px;
}

@media (max-width: 1040px) {
  .marketPanel {
    --market-panel-scale: 0.72;
  }

  .marketSummary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
`;
    document.head.appendChild(style);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
