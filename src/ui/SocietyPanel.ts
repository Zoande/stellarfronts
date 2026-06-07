import type { ClientCommand, SocietyDetailPayload } from "../game/GameProtocol";
import { SPECIES_ARCHETYPE_BY_ID, SPECIES_TRAIT_BY_ID } from "../data/Species";
import type { SpeciesRights, SpeciesRightsCategory, SpeciesState } from "../data/Species";
import { PanelInteractionGate, captureScrollState, restoreScrollStateSoon } from "./panelDomState";

export interface SocietyPanelData extends SocietyDetailPayload {
  factionName?: string;
  clockYear: number;
  onSocietyCommand?: (command: ClientCommand) => void;
  onClose?: () => void;
}

const STYLE_ID = "society-panel-style";
const SOCIETY_SCROLL_SELECTORS = [".societySpeciesList", ".societyDetailScroll"] as const;

type RightsCategoryConfig = {
  key: SpeciesRightsCategory;
  label: string;
  optionsKey: keyof SocietyDetailPayload["legalOptions"];
};

const RIGHTS_CATEGORIES: RightsCategoryConfig[] = [
  { key: "livingStandard", label: "Living Standards", optionsKey: "livingStandards" },
  { key: "citizenship", label: "Citizenship", optionsKey: "citizenship" },
  { key: "migration", label: "Migration", optionsKey: "migration" },
  { key: "workEligibility", label: "Work Eligibility", optionsKey: "workEligibility" },
];

export class SocietyPanel {
  private root: HTMLDivElement;
  private panelElement: HTMLDivElement | null = null;
  private currentData: SocietyPanelData | null = null;
  private selectedSpeciesId: string | null = null;
  private position = { x: 78, y: 70 };
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

  public show(data: SocietyPanelData): void {
    this.currentData = data;
    this.ensureSelection(data);
    const scrollState = captureScrollState(this.panelElement, SOCIETY_SCROLL_SELECTORS);
    if (!this.panelElement) {
      this.panelElement = document.createElement("div");
      this.panelElement.className = "societyPanel";
      this.root.appendChild(this.panelElement);
    }
    this.interactionGate.bind(this.panelElement);
    const accent = data.faction ? this.colorToCss(data.faction.color, 0.95) : "rgba(92, 245, 218, 0.95)";
    this.panelElement.style.setProperty("--society-accent", accent);
    this.panelElement.innerHTML = this.render(data);
    this.applyPosition();
    this.bindEvents(data);
    restoreScrollStateSoon(this.panelElement, scrollState);
  }

  public refresh(data: SocietyPanelData): void {
    if (!this.panelElement) return;
    this.show(data);
  }

  public close(): void {
    const onClose = this.currentData?.onClose;
    this.onPointerUp();
    this.interactionGate.clear();
    this.panelElement?.remove();
    this.panelElement = null;
    this.currentData = null;
    onClose?.();
  }

  public dispose(): void {
    this.close();
  }

  private ensureSelection(data: SocietyPanelData): void {
    if (data.species.some((species) => species.id === this.selectedSpeciesId)) return;
    this.selectedSpeciesId = data.species[0]?.id ?? null;
  }

  private bindEvents(data: SocietyPanelData): void {
    if (!this.panelElement) return;
    this.panelElement.querySelector<HTMLButtonElement>("[data-society-close]")?.addEventListener("click", () => this.close());
    this.panelElement.querySelector<HTMLElement>("[data-society-drag]")?.addEventListener("pointerdown", (ev) => {
      if (!this.panelElement) return;
      if ((ev.target as HTMLElement).closest("button, select")) return;
      ev.preventDefault();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelectorAll<HTMLButtonElement>("[data-society-species]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedSpeciesId = button.dataset.societySpecies ?? null;
        this.show(data);
      });
    });
    this.panelElement.querySelectorAll<HTMLSelectElement>("[data-society-right]").forEach((select) => {
      select.addEventListener("change", () => {
        const speciesId = this.selectedSpeciesId;
        const category = select.dataset.societyRight as SpeciesRightsCategory | undefined;
        if (!speciesId || !category) return;
        data.onSocietyCommand?.({
          type: "setSpeciesRights",
          speciesId,
          rights: { [category]: select.value } as Partial<SpeciesRights>,
        });
      });
    });
  }

  private render(data: SocietyPanelData): string {
    const selected = data.species.find((species) => species.id === this.selectedSpeciesId) ?? data.species[0] ?? null;
    const totalPops = data.planets.reduce((sum, planet) => sum + planet.population, 0);
    return `
      <div class="societyHeader" data-society-drag>
        <div class="societyHeaderIcon">SC</div>
        <div class="societyHeaderText">
          <div class="societyTitle">Society</div>
          <div class="societySubtitle">${this.escapeHtml(data.factionName ?? data.faction?.name ?? "Population Office")}</div>
        </div>
        <div class="societyHeaderStats">
          <span>${data.species.length} species</span>
          <strong>${this.formatPopulation(totalPops)}</strong>
        </div>
        <button class="societyClose" type="button" data-society-close aria-label="Close society">X</button>
      </div>
      <section class="societyBody">
        <aside class="societySidebar">
          <div class="societySectionTitle">
            <strong>Empire Species</strong>
            <span>${data.planets.length} worlds</span>
          </div>
          <div class="societySpeciesList">
            ${data.species.length
              ? data.species.map((species) => this.renderSpeciesRow(data, species)).join("")
              : '<div class="societyEmpty">No resident species found.</div>'}
          </div>
        </aside>
        <main class="societyDetail">
          ${selected ? this.renderSpeciesDetail(data, selected) : '<div class="societyEmpty large">No species selected.</div>'}
        </main>
      </section>
    `;
  }

  private renderSpeciesRow(data: SocietyPanelData, species: SpeciesState): string {
    const selected = species.id === this.selectedSpeciesId;
    const archetype = SPECIES_ARCHETYPE_BY_ID[species.archetypeId];
    const population = this.getSpeciesPopulation(data, species.id);
    const averageHappiness = this.getWeightedSpeciesPlanetMetric(data, species.id, "averageHappiness");
    return `
      <button class="societySpeciesRow ${selected ? "selected" : ""}" type="button" data-society-species="${this.escapeAttribute(species.id)}">
        <span class="societySpeciesIcon">${this.escapeHtml(archetype?.icon ?? "SP")}</span>
        <span class="societySpeciesCopy">
          <strong>${this.escapeHtml(species.name)}</strong>
          <small>${this.escapeHtml(archetype?.name ?? "Species")} / ${this.formatPopulation(population)}</small>
        </span>
        <span class="societySpeciesMetric">${Math.round(averageHappiness)}%</span>
      </button>
    `;
  }

  private renderSpeciesDetail(data: SocietyPanelData, species: SpeciesState): string {
    const archetype = SPECIES_ARCHETYPE_BY_ID[species.archetypeId];
    const population = this.getSpeciesPopulation(data, species.id);
    const averageHappiness = this.getWeightedSpeciesPlanetMetric(data, species.id, "averageHappiness");
    const averageHabitability = this.getWeightedSpeciesPlanetMetric(data, species.id, "averageHabitability");
    const traits = species.traitIds.map((traitId) => SPECIES_TRAIT_BY_ID[traitId]).filter(Boolean);
    return `
      <div class="societyDetailScroll">
        <section class="societyHero">
          <div class="societyHeroIcon">${this.escapeHtml(archetype?.icon ?? "SP")}</div>
          <div>
            <div class="societyHeroKicker">${this.escapeHtml(archetype?.name ?? "Species")}</div>
            <h2>${this.escapeHtml(species.name)}</h2>
            <p>${this.escapeHtml(archetype?.summary ?? "Resident population group.")}</p>
          </div>
          <div class="societyHeroStats">
            <div><span>Population</span><strong>${this.formatPopulation(population)}</strong></div>
            <div><span>Happiness</span><strong>${Math.round(averageHappiness)}%</strong></div>
            <div><span>Habitability</span><strong>${Math.round(averageHabitability)}%</strong></div>
          </div>
        </section>
        <section class="societyGrid">
          <div class="societyCard societyRightsCard">
            <div class="societyCardTitle">Species Rights</div>
            <div class="societyLawStrip">
              <span>Civil Rights: ${this.escapeHtml(this.formatLawId(data.laws.civilRights))}</span>
              <span>Species Policy: ${this.escapeHtml(this.formatLawId(data.laws.speciesPolicy))}</span>
            </div>
            ${this.renderRightsEditor(data, species)}
          </div>
          <div class="societyCard">
            <div class="societyCardTitle">Traits</div>
            <div class="societyTraitList">
              ${traits.length
                ? traits.map((trait) => `
                  <div class="societyTrait ${trait.polarity}">
                    <strong>${this.escapeHtml(trait.name)}</strong>
                    <span>${trait.pointCost > 0 ? `-${trait.pointCost}` : `+${Math.abs(trait.pointCost)}`}</span>
                    <small>${this.escapeHtml(trait.description)}</small>
                  </div>
                `).join("")
                : '<div class="societyEmpty compact">No locked traits.</div>'}
            </div>
          </div>
          <div class="societyCard wide">
            <div class="societyCardTitle">Planet Distribution</div>
            <div class="societyPlanetList">
              ${this.renderPlanetDistribution(data, species.id)}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  private renderRightsEditor(data: SocietyPanelData, species: SpeciesState): string {
    const rights = data.rights?.rightsBySpeciesId[species.id];
    if (!rights) return '<div class="societyEmpty compact">Rights are unavailable.</div>';
    return `
      <div class="societyRightsGrid">
        ${RIGHTS_CATEGORIES.map((category) => {
          const options = data.legalOptions[category.optionsKey];
          const value = rights[category.key];
          return `
            <label class="societyRightSelect">
              <span>${this.escapeHtml(category.label)}</span>
              <select data-society-right="${category.key}">
                ${options.map((option) => `
                  <option value="${this.escapeAttribute(option.id)}" ${option.id === value ? "selected" : ""} ${option.allowed ? "" : "disabled"}>
                    ${this.escapeHtml(option.name)}${option.allowed ? "" : ` - ${this.escapeHtml(option.reason ?? "Blocked")}`}
                  </option>
                `).join("")}
              </select>
            </label>
          `;
        }).join("")}
      </div>
    `;
  }

  private renderPlanetDistribution(data: SocietyPanelData, speciesId: string): string {
    const rows = data.planets
      .map((planet) => ({
        planet,
        population: planet.speciesPopulations.find((entry) => entry.speciesId === speciesId)?.population ?? 0,
      }))
      .filter((entry) => entry.population > 0)
      .sort((a, b) => b.population - a.population);
    if (rows.length === 0) return '<div class="societyEmpty compact">No known planets contain this species.</div>';
    return rows.map(({ planet, population }) => {
      const share = planet.population > 0 ? population / planet.population : 0;
      return `
        <div class="societyPlanetRow">
          <div>
            <strong>${this.escapeHtml(planet.planetName)}</strong>
            <small>${this.escapeHtml(planet.starName)}</small>
          </div>
          <div class="societyPlanetBar"><span style="width:${Math.round(share * 100)}%"></span></div>
          <span>${this.formatPopulation(population)}</span>
        </div>
      `;
    }).join("");
  }

  private getSpeciesPopulation(data: SocietyPanelData, speciesId: string): number {
    return data.planets.reduce((sum, planet) => (
      sum + (planet.speciesPopulations.find((entry) => entry.speciesId === speciesId)?.population ?? 0)
    ), 0);
  }

  private getWeightedSpeciesPlanetMetric(
    data: SocietyPanelData,
    speciesId: string,
    metric: "averageHappiness" | "averageHabitability",
  ): number {
    let total = 0;
    let weighted = 0;
    for (const planet of data.planets) {
      const population = planet.speciesPopulations.find((entry) => entry.speciesId === speciesId)?.population ?? 0;
      if (population <= 0) continue;
      total += population;
      weighted += planet[metric] * population;
    }
    return total > 0 ? weighted / total : 0;
  }

  private formatPopulation(population: number): string {
    if (population >= 1_000_000_000) return `${(population / 1_000_000_000).toFixed(1)}B`;
    if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M`;
    return `${Math.round(population)}`;
  }

  private formatLawId(value: string): string {
    return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
  }

  private applyPosition(): void {
    if (!this.panelElement) return;
    this.panelElement.style.left = `${this.position.x}px`;
    this.panelElement.style.top = `${this.position.y}px`;
  }

  private colorToCss(color: [number, number, number] | undefined, alpha = 1): string {
    if (!color) return `rgba(92, 245, 218, ${alpha})`;
    const [r, g, b] = color.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private escapeAttribute(value: unknown): string {
    return this.escapeHtml(value);
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .societyPanel {
        --society-accent: rgba(92, 245, 218, 0.95);
        position: fixed;
        z-index: 78;
        width: min(1080px, calc(100vw - 136px));
        max-width: calc(100vw - 24px);
        height: min(690px, calc(100vh - 96px));
        min-height: 520px;
        border: 1px solid color-mix(in srgb, var(--society-accent) 78%, rgba(255,255,255,0.2));
        background:
          linear-gradient(135deg, rgba(8, 34, 38, 0.95), rgba(3, 10, 18, 0.98) 48%, rgba(6, 22, 31, 0.96)),
          radial-gradient(circle at 70% 0%, color-mix(in srgb, var(--society-accent) 15%, transparent), transparent 38%);
        box-shadow: 0 0 0 1px rgba(120, 255, 226, 0.12) inset, 0 22px 60px rgba(0, 0, 0, 0.48);
        color: #d8f8f0;
        font-family: "Rajdhani", "Orbitron", sans-serif;
        overflow: hidden;
      }
      .societyHeader {
        height: 88px;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto;
        gap: 16px;
        align-items: center;
        padding: 16px 20px;
        cursor: grab;
        border-bottom: 1px solid rgba(120, 255, 226, 0.24);
        background: linear-gradient(90deg, rgba(7, 28, 30, 0.92), rgba(4, 13, 20, 0.78));
      }
      .societyHeaderIcon {
        width: 54px;
        height: 54px;
        display: grid;
        place-items: center;
        border: 1px solid color-mix(in srgb, var(--society-accent) 76%, rgba(255,255,255,0.16));
        border-radius: 50%;
        color: #b8fff0;
        background: rgba(16, 96, 83, 0.28);
        font-weight: 900;
      }
      .societyTitle {
        color: #f0fffb;
        font-size: 1.85rem;
        font-weight: 900;
        letter-spacing: 0;
        line-height: 1;
      }
      .societySubtitle,
      .societyHeaderStats span,
      .societySectionTitle span {
        color: rgba(177, 221, 218, 0.72);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.13em;
        text-transform: uppercase;
      }
      .societyHeaderStats {
        display: grid;
        justify-items: end;
        gap: 4px;
      }
      .societyHeaderStats strong {
        color: #f0fffb;
        font-size: 1.35rem;
      }
      .societyClose {
        width: 42px;
        height: 42px;
        border: 1px solid rgba(184, 255, 240, 0.52);
        background: rgba(5, 14, 22, 0.82);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 1.1rem;
        font-weight: 900;
      }
      .societyBody {
        height: calc(100% - 88px);
        display: grid;
        grid-template-columns: 310px minmax(0, 1fr);
        gap: 16px;
        padding: 16px;
      }
      .societySidebar,
      .societyDetail,
      .societyCard {
        border: 1px solid rgba(120, 255, 226, 0.22);
        background: rgba(4, 18, 24, 0.72);
        box-shadow: 0 0 24px rgba(0, 0, 0, 0.18) inset;
      }
      .societySidebar {
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        padding: 12px;
      }
      .societySectionTitle,
      .societyCardTitle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #78ffe1;
        font-size: 0.82rem;
        font-weight: 900;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      .societySpeciesList {
        min-height: 0;
        overflow: auto;
        display: grid;
        align-content: start;
        gap: 8px;
        margin-top: 10px;
        padding-right: 4px;
      }
      .societySpeciesRow {
        min-height: 68px;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(120, 255, 226, 0.22);
        background: rgba(5, 20, 27, 0.8);
        color: inherit;
        cursor: pointer;
        font: inherit;
        padding: 8px;
        text-align: left;
      }
      .societySpeciesRow.selected,
      .societySpeciesRow:hover {
        border-color: color-mix(in srgb, var(--society-accent) 84%, #ffffff);
        background: color-mix(in srgb, var(--society-accent) 17%, rgba(5, 20, 27, 0.88));
      }
      .societySpeciesIcon,
      .societyHeroIcon {
        display: grid;
        place-items: center;
        border: 1px solid rgba(145, 255, 232, 0.42);
        background: rgba(24, 128, 108, 0.24);
        color: #baffef;
        font-weight: 900;
      }
      .societySpeciesIcon {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        font-size: 0.74rem;
      }
      .societySpeciesCopy {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .societySpeciesCopy strong {
        color: #f0fffb;
        font-size: 0.96rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societySpeciesCopy small,
      .societyPlanetRow small,
      .societyTrait small,
      .societyHero p {
        color: rgba(207, 229, 228, 0.68);
      }
      .societySpeciesMetric {
        color: #ffd56d;
        font-weight: 900;
      }
      .societyDetail {
        min-height: 0;
        overflow: hidden;
      }
      .societyDetailScroll {
        height: 100%;
        overflow: auto;
        padding: 14px;
      }
      .societyHero {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr) minmax(240px, auto);
        gap: 16px;
        align-items: center;
        border: 1px solid rgba(120, 255, 226, 0.24);
        background: linear-gradient(90deg, rgba(6, 33, 36, 0.84), rgba(4, 14, 22, 0.78));
        padding: 14px;
      }
      .societyHeroIcon {
        width: 68px;
        height: 68px;
        border-radius: 50%;
        font-size: 1.05rem;
      }
      .societyHeroKicker {
        color: #78ffe1;
        font-size: 0.74rem;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .societyHero h2 {
        margin: 3px 0;
        color: #f0fffb;
        font-size: 1.9rem;
        line-height: 1;
        letter-spacing: 0;
      }
      .societyHero p {
        margin: 0;
        line-height: 1.35;
      }
      .societyHeroStats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .societyHeroStats div {
        min-width: 0;
        border-left: 1px solid rgba(120, 255, 226, 0.18);
        padding-left: 10px;
      }
      .societyHeroStats span {
        color: rgba(177, 221, 218, 0.7);
        font-size: 0.72rem;
        text-transform: uppercase;
      }
      .societyHeroStats strong {
        display: block;
        color: #ffffff;
        font-size: 1.05rem;
      }
      .societyGrid {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
        gap: 12px;
        margin-top: 12px;
      }
      .societyCard {
        min-width: 0;
        padding: 14px;
      }
      .societyCard.wide {
        grid-column: 1 / -1;
      }
      .societyLawStrip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 12px;
      }
      .societyLawStrip span {
        border: 1px solid rgba(120, 255, 226, 0.2);
        background: rgba(7, 28, 32, 0.74);
        color: rgba(230, 255, 249, 0.82);
        font-size: 0.72rem;
        font-weight: 800;
        padding: 5px 8px;
        text-transform: uppercase;
      }
      .societyRightsGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .societyRightSelect {
        display: grid;
        gap: 6px;
        color: #93ffe7;
        font-size: 0.74rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .societyRightSelect select {
        min-height: 36px;
        border: 1px solid rgba(177, 221, 218, 0.42);
        background: rgba(3, 10, 16, 0.9);
        color: #f0fffb;
        font: inherit;
        font-size: 0.84rem;
        padding: 0 9px;
      }
      .societyTraitList {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .societyTrait {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px 10px;
        border: 1px solid rgba(120, 255, 226, 0.18);
        background: rgba(5, 20, 27, 0.68);
        padding: 9px;
      }
      .societyTrait strong {
        color: #f0fffb;
      }
      .societyTrait span {
        color: #ffd56d;
        font-weight: 900;
      }
      .societyTrait.negative span {
        color: #84ffd9;
      }
      .societyTrait small {
        grid-column: 1 / -1;
        line-height: 1.32;
      }
      .societyPlanetList {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .societyPlanetRow {
        display: grid;
        grid-template-columns: minmax(150px, 1fr) minmax(160px, 0.9fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(120, 255, 226, 0.16);
        background: rgba(5, 20, 27, 0.54);
        padding: 8px 10px;
      }
      .societyPlanetRow strong {
        color: #f0fffb;
      }
      .societyPlanetRow small {
        display: block;
      }
      .societyPlanetBar {
        height: 8px;
        border: 1px solid rgba(120, 255, 226, 0.18);
        background: rgba(0, 0, 0, 0.3);
      }
      .societyPlanetBar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--society-accent), #ffd56d);
      }
      .societyEmpty {
        border: 1px dashed rgba(177, 221, 218, 0.25);
        color: rgba(207, 229, 228, 0.66);
        padding: 14px;
        text-align: center;
      }
      .societyEmpty.compact {
        padding: 10px;
        text-align: left;
      }
      .societyEmpty.large {
        margin: 20px;
      }
      @media (max-width: 980px) {
        .societyPanel {
          left: 8px !important;
          top: 68px !important;
          width: calc(100vw - 16px);
          height: calc(100vh - 84px);
        }
        .societyBody,
        .societyHero,
        .societyGrid {
          grid-template-columns: 1fr;
        }
        .societySidebar {
          min-height: 220px;
        }
      }
      @media (max-width: 680px) {
        .societyHeader {
          grid-template-columns: auto minmax(0, 1fr) auto;
        }
        .societyHeaderStats {
          display: none;
        }
        .societyRightsGrid,
        .societyHeroStats,
        .societyPlanetRow {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
