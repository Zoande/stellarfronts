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
  private searchTerm = "";
  private position = { x: 108, y: 88 };
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
      if ((ev.target as HTMLElement).closest("button, select, input")) return;
      ev.preventDefault();
      ev.stopPropagation();
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = ev.clientX - rect.left;
      this.dragOffset.y = ev.clientY - rect.top;
      this.isDragging = true;
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    });
    this.panelElement.querySelector<HTMLInputElement>("[data-society-search]")?.addEventListener("input", (ev) => {
      this.searchTerm = (ev.currentTarget as HTMLInputElement).value;
      this.show(data);
      this.panelElement?.querySelector<HTMLInputElement>("[data-society-search]")?.focus();
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
    const visibleSpecies = this.getVisibleSpecies(data);
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
          <div class="societySearchRow">
            <span class="societySearchIcon" aria-hidden="true"></span>
            <input type="search" value="${this.escapeAttribute(this.searchTerm)}" placeholder="Search species..." aria-label="Search species" data-society-search>
            <button type="button" aria-label="Filter species"><span class="societyFilterIcon" aria-hidden="true"></span></button>
          </div>
          <div class="societySpeciesList">
            ${visibleSpecies.length
              ? visibleSpecies.map((species) => this.renderSpeciesRow(data, species)).join("")
              : '<div class="societyEmpty">No species match that search.</div>'}
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
          <div class="societyHeroIcon"><span>${this.escapeHtml(archetype?.icon ?? "SP")}</span></div>
          <div class="societyHeroCopy">
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
            <div class="societyCardTitle"><span class="societyCardIcon">RG</span>Species Rights</div>
            <div class="societyLawStrip">
              <span><strong>Civil Rights</strong>${this.escapeHtml(this.formatLawId(data.laws.civilRights))}</span>
              <span><strong>Species Policy</strong>${this.escapeHtml(this.formatLawId(data.laws.speciesPolicy))}</span>
            </div>
            ${this.renderRightsEditor(data, species)}
          </div>
          <div class="societyCard">
            <div class="societyCardTitle"><span class="societyCardIcon">TR</span>Traits</div>
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
            <div class="societyCardTitle"><span class="societyCardIcon">PL</span>Planet Distribution</div>
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

  private getVisibleSpecies(data: SocietyPanelData): SpeciesState[] {
    const needle = this.searchTerm.trim().toLowerCase();
    if (!needle) return data.species;
    return data.species.filter((species) => {
      const archetype = SPECIES_ARCHETYPE_BY_ID[species.archetypeId];
      return species.name.toLowerCase().includes(needle)
        || (archetype?.name.toLowerCase().includes(needle) ?? false)
        || species.traitIds.some((traitId) => SPECIES_TRAIT_BY_ID[traitId]?.name.toLowerCase().includes(needle));
    });
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
    const rect = this.panelElement.getBoundingClientRect();
    this.position.x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, this.position.x));
    this.position.y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, this.position.y));
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

      .societyPanel {
        width: min(1060px, calc(100vw - 180px));
        height: min(604px, calc(100vh - 128px));
        min-height: 468px;
        border-color: rgba(48, 235, 218, 0.78);
        border-radius: 6px;
        background:
          linear-gradient(135deg, rgba(7, 35, 38, 0.96), rgba(3, 12, 18, 0.98) 48%, rgba(6, 24, 31, 0.96)),
          radial-gradient(circle at 74% 8%, rgba(58, 255, 226, 0.12), transparent 34%);
        box-shadow:
          0 0 0 1px rgba(114, 255, 229, 0.2) inset,
          0 0 28px rgba(34, 255, 223, 0.18),
          0 28px 70px rgba(0, 0, 0, 0.52);
        font-size: 13px;
      }
      .societyPanel::before,
      .societyPanel::after {
        content: "";
        position: absolute;
        pointer-events: none;
        border-color: rgba(82, 255, 232, 0.9);
        border-style: solid;
        filter: drop-shadow(0 0 8px rgba(82, 255, 232, 0.54));
      }
      .societyPanel::before {
        left: 0;
        top: 0;
        width: 42px;
        height: 42px;
        border-width: 2px 0 0 2px;
      }
      .societyPanel::after {
        right: 0;
        bottom: 0;
        width: 42px;
        height: 42px;
        border-width: 0 2px 2px 0;
      }
      .societyHeader {
        height: 88px;
        grid-template-columns: 62px minmax(0, 1fr) auto 44px;
        gap: 14px;
        padding: 14px 18px 12px;
        border-bottom: 0;
        background:
          linear-gradient(90deg, rgba(4, 24, 27, 0.9), rgba(7, 20, 29, 0.72)),
          linear-gradient(135deg, transparent 0 58%, rgba(60, 255, 231, 0.08) 58% 100%);
        touch-action: none;
        user-select: none;
      }
      .societyHeader:active {
        cursor: grabbing;
      }
      .societyHeaderIcon {
        width: 54px;
        height: 54px;
        box-shadow: 0 0 18px rgba(48, 235, 218, 0.22) inset, 0 0 18px rgba(48, 235, 218, 0.18);
      }
      .societyTitle {
        font-size: 1.72rem;
      }
      .societySubtitle {
        margin-top: 4px;
        color: color-mix(in srgb, var(--society-accent) 86%, #86fff2);
        font-size: 0.78rem;
        letter-spacing: 0.12em;
      }
      .societyHeaderStats {
        min-width: 92px;
      }
      .societyHeaderStats strong {
        font-size: 1.55rem;
        line-height: 1;
      }
      .societyClose {
        width: 42px;
        height: 42px;
        border-color: rgba(89, 255, 233, 0.58);
        border-radius: 4px;
        background: rgba(6, 30, 34, 0.82);
        box-shadow: 0 0 18px rgba(54, 255, 230, 0.18), 0 0 18px rgba(54, 255, 230, 0.12) inset;
        font-size: 1.2rem;
      }
      .societyBody {
        height: calc(100% - 88px);
        grid-template-columns: 300px minmax(0, 1fr);
        gap: 12px;
        padding: 0 12px 12px;
      }
      .societySidebar,
      .societyDetail,
      .societyCard,
      .societyHero {
        border-color: rgba(74, 255, 228, 0.26);
        border-radius: 5px;
        background:
          linear-gradient(180deg, rgba(8, 38, 42, 0.78), rgba(3, 14, 20, 0.84)),
          radial-gradient(circle at 60% 0%, rgba(67, 255, 224, 0.08), transparent 45%);
        box-shadow: 0 0 24px rgba(11, 255, 221, 0.08) inset;
      }
      .societySidebar {
        padding: 14px;
      }
      .societySectionTitle,
      .societyCardTitle {
        color: #70ffe5;
        font-size: 0.84rem;
        letter-spacing: 0.08em;
      }
      .societySearchRow {
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 4px;
        margin: 12px 0 10px;
      }
      .societySearchRow input {
        min-height: 34px;
        border: 1px solid rgba(132, 255, 232, 0.32);
        border-radius: 3px;
        background: rgba(2, 12, 18, 0.82);
        color: #e9fffb;
        font: inherit;
        padding: 0 9px;
        outline: none;
      }
      .societySearchRow input:focus {
        border-color: rgba(112, 255, 229, 0.72);
        box-shadow: 0 0 0 1px rgba(112, 255, 229, 0.2);
      }
      .societySearchRow button {
        width: 34px;
        height: 34px;
        border: 1px solid rgba(112, 255, 229, 0.34);
        border-radius: 3px;
        background: rgba(8, 28, 34, 0.82);
        cursor: default;
      }
      .societySearchIcon,
      .societyFilterIcon {
        display: block;
        position: relative;
      }
      .societySearchIcon {
        width: 15px;
        height: 15px;
        margin-left: 4px;
        border: 2px solid rgba(177, 239, 232, 0.7);
        border-radius: 50%;
      }
      .societySearchIcon::after {
        content: "";
        position: absolute;
        right: -6px;
        bottom: -5px;
        width: 8px;
        height: 2px;
        background: rgba(177, 239, 232, 0.7);
        transform: rotate(45deg);
      }
      .societyFilterIcon {
        width: 18px;
        height: 15px;
        margin: 0 auto;
        border-top: 2px solid rgba(112, 255, 229, 0.72);
        border-bottom: 2px solid rgba(112, 255, 229, 0.72);
      }
      .societyFilterIcon::before {
        content: "";
        position: absolute;
        left: 4px;
        right: 4px;
        top: 5px;
        border-top: 2px solid rgba(112, 255, 229, 0.72);
      }
      .societySpeciesList {
        gap: 7px;
        margin-top: 0;
      }
      .societySpeciesRow {
        min-height: 62px;
        grid-template-columns: 42px minmax(0, 1fr) 44px;
        gap: 9px;
        border-radius: 4px;
        background: linear-gradient(90deg, rgba(13, 39, 48, 0.82), rgba(16, 30, 43, 0.76));
        padding: 8px 10px;
      }
      .societySpeciesRow.selected {
        border-color: rgba(255, 118, 240, 0.78);
        box-shadow: 0 0 0 1px rgba(255, 118, 240, 0.28) inset, 0 0 18px rgba(255, 118, 240, 0.18);
      }
      .societySpeciesIcon {
        width: 38px;
        height: 38px;
        color: #8bffeb;
      }
      .societySpeciesCopy strong {
        font-size: 0.94rem;
      }
      .societySpeciesCopy small {
        font-size: 0.78rem;
      }
      .societySpeciesMetric {
        color: #ffd069;
        font-size: 1.02rem;
      }
      .societyDetailScroll {
        padding: 10px;
      }
      .societyHero {
        grid-template-columns: 78px minmax(0, 1fr) minmax(250px, auto);
        min-height: 116px;
        gap: 14px;
        padding: 12px 14px;
      }
      .societyHeroIcon {
        width: 66px;
        height: 66px;
        border-radius: 50%;
        overflow: hidden;
        box-shadow: 0 0 24px rgba(47, 255, 226, 0.18) inset, 0 0 20px rgba(47, 255, 226, 0.16);
      }
      .societyHeroIcon span {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        background:
          radial-gradient(circle at 34% 28%, rgba(118, 255, 227, 0.45), transparent 0 16%, rgba(5, 42, 48, 0.75) 17% 100%),
          conic-gradient(from 25deg, rgba(32, 255, 225, 0.28), rgba(18, 68, 82, 0.7), rgba(110, 255, 214, 0.22));
        color: #d8fff8;
      }
      .societyHeroKicker {
        font-size: 0.76rem;
        letter-spacing: 0.09em;
      }
      .societyHero h2 {
        font-size: 1.62rem;
        margin: 4px 0;
      }
      .societyHero p {
        max-width: 360px;
        font-size: 0.9rem;
      }
      .societyHeroStats {
        min-width: 250px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .societyHeroStats span {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.05em;
      }
      .societyHeroStats strong {
        font-size: 1rem;
      }
      .societyGrid {
        grid-template-columns: minmax(0, 1fr) 360px;
        gap: 10px;
        margin-top: 10px;
      }
      .societyCard {
        padding: 12px;
      }
      .societyCardTitle {
        justify-content: flex-start;
        gap: 9px;
      }
      .societyCardIcon {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid rgba(112, 255, 229, 0.32);
        border-radius: 50%;
        background: rgba(21, 121, 102, 0.18);
        font-size: 0.66rem;
      }
      .societyLawStrip {
        display: grid;
        gap: 8px;
        margin: 10px 0;
      }
      .societyLawStrip span {
        display: grid;
        grid-template-columns: 130px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        border-radius: 3px;
        font-size: 0.78rem;
        padding: 8px 10px;
      }
      .societyLawStrip strong {
        color: #ecfffb;
      }
      .societyRightsGrid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .societyRightSelect {
        border: 1px solid rgba(112, 255, 229, 0.2);
        border-radius: 4px;
        background: rgba(5, 28, 34, 0.66);
        padding: 8px;
      }
      .societyRightSelect span {
        font-size: 0.72rem;
      }
      .societyRightSelect select {
        min-height: 32px;
        border-radius: 3px;
        font-size: 0.82rem;
      }
      .societyTraitList {
        gap: 10px;
        margin-top: 12px;
      }
      .societyTrait {
        min-height: 72px;
        border-radius: 4px;
        padding: 10px;
      }
      .societyTrait strong {
        font-size: 0.98rem;
      }
      .societyTrait span {
        font-size: 1.05rem;
      }
      .societyTrait small {
        font-size: 0.82rem;
      }
      .societyPlanetList {
        margin-top: 10px;
      }
      .societyPlanetRow {
        min-height: 46px;
        grid-template-columns: minmax(170px, 1fr) minmax(190px, 0.9fr) 54px;
        border-radius: 4px;
      }
      .societyPlanetBar {
        height: 7px;
      }
      @media (max-width: 1260px) {
        .societyPanel {
          width: calc(100vw - 104px);
        }
        .societyBody {
          grid-template-columns: 280px minmax(0, 1fr);
        }
        .societyGrid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 920px) {
        .societyPanel {
          width: calc(100vw - 20px);
          height: calc(100vh - 82px);
          min-height: 0;
        }
        .societyHeader {
          grid-template-columns: 48px minmax(0, 1fr) 40px;
          height: 74px;
          padding: 10px 12px;
        }
        .societyHeaderIcon {
          width: 44px;
          height: 44px;
        }
        .societyTitle {
          font-size: 1.34rem;
        }
        .societyHeaderStats {
          display: none;
        }
        .societyBody {
          height: calc(100% - 74px);
          grid-template-columns: 1fr;
          grid-template-rows: minmax(170px, 0.34fr) minmax(0, 1fr);
          padding: 0 10px 10px;
        }
        .societyHero {
          grid-template-columns: 58px minmax(0, 1fr);
        }
        .societyHeroStats {
          grid-column: 1 / -1;
          min-width: 0;
        }
        .societyRightsGrid,
        .societyPlanetRow {
          grid-template-columns: 1fr;
        }
      }

      .societyPanel {
        --society-panel-scale: 0.84;
        z-index: 98;
        width: min(1180px, calc(100vw - 32px));
        height: min(668px, calc(100vh - 32px));
        min-height: 0;
        pointer-events: auto;
        display: grid;
        grid-template-rows: 64px minmax(0, 1fr);
        overflow: hidden;
        transform: scale(var(--society-panel-scale));
        transform-origin: top left;
        border: 1px solid color-mix(in srgb, var(--society-accent) 76%, transparent);
        border-radius: 0;
        background:
          radial-gradient(circle at 78% 10%, color-mix(in srgb, var(--society-accent) 11%, transparent), transparent 17rem),
          linear-gradient(180deg, rgba(4, 27, 30, 0.98), rgba(1, 11, 14, 0.99));
        box-shadow: 0 28px 82px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        color: #e9fff9;
        font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
        font-size: 11px;
        user-select: none;
      }
      .societyPanel,
      .societyPanel * {
        box-sizing: border-box;
      }
      .societyPanel::before {
        inset: 0;
        width: auto;
        height: auto;
        border: 1px solid rgba(62, 255, 226, 0.12);
        clip-path: polygon(0 24px, 24px 0, 36% 0, 37% 6px, 64% 6px, 65% 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);
        filter: none;
      }
      .societyPanel::after {
        left: 14px;
        right: 14px;
        top: 62px;
        bottom: auto;
        width: auto;
        height: 1px;
        border: 0;
        background: linear-gradient(90deg, transparent, rgba(72, 255, 230, 0.72), transparent);
        filter: none;
      }
      .societyHeader {
        min-width: 0;
        height: 64px;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto 38px;
        gap: 12px;
        align-items: center;
        padding: 8px 12px;
        cursor: grab;
        background:
          radial-gradient(circle at 24% -30%, color-mix(in srgb, var(--society-accent) 18%, transparent), transparent 13rem),
          linear-gradient(90deg, rgba(7, 52, 55, 0.9), rgba(4, 19, 24, 0.95));
        border-bottom: 1px solid rgba(87, 250, 223, 0.27);
        touch-action: none;
      }
      .societyHeaderIcon {
        width: 38px;
        height: 38px;
        border-radius: 0;
        clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
        border: 0;
        background: linear-gradient(135deg, var(--society-accent), #f0d65d);
        color: #051a16;
        font-size: 12px;
        font-weight: 950;
        box-shadow: 0 0 18px color-mix(in srgb, var(--society-accent) 34%, transparent), inset 0 0 0 2px rgba(7, 0, 18, 0.4);
      }
      .societyHeaderText {
        min-width: 0;
      }
      .societyTitle {
        color: #eafff8;
        font-size: 22px;
        font-weight: 950;
        line-height: 1.05;
        letter-spacing: 0;
      }
      .societySubtitle {
        margin-top: 3px;
        color: rgba(204, 236, 229, 0.7);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .societyHeaderStats {
        min-width: 92px;
        display: grid;
        justify-items: end;
        gap: 2px;
      }
      .societyHeaderStats span {
        color: color-mix(in srgb, var(--society-accent) 78%, rgba(204, 236, 229, 0.7));
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.12em;
      }
      .societyHeaderStats strong {
        color: #ffffff;
        font-size: 20px;
        line-height: 1;
      }
      .societyClose {
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(98, 255, 228, 0.56);
        border-radius: 0;
        background: rgba(6, 43, 43, 0.72);
        color: #bffff4;
        font: inherit;
        font-size: 17px;
        font-weight: 900;
        cursor: pointer;
      }
      .societyClose:hover {
        color: #ffffff;
        border-color: rgba(141, 255, 236, 0.9);
        background: rgba(10, 65, 61, 0.84);
      }
      .societyBody {
        min-height: 0;
        height: auto;
        display: grid;
        grid-template-columns: 286px minmax(0, 1fr);
        gap: 8px;
        padding: 8px 12px 10px;
      }
      .societySidebar,
      .societyDetail,
      .societyCard,
      .societyHero {
        min-width: 0;
        min-height: 0;
        border: 1px solid rgba(76, 223, 197, 0.25);
        border-radius: 0;
        background: rgba(2, 20, 23, 0.68);
        box-shadow: inset 0 0 28px rgba(50, 187, 143, 0.06);
      }
      .societySidebar {
        display: grid;
        grid-template-rows: 34px 34px minmax(0, 1fr);
        gap: 8px;
        padding: 10px;
        overflow: hidden;
      }
      .societySectionTitle,
      .societyCardTitle {
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: #70ffe5;
        font-size: 13px;
        font-weight: 950;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .societySectionTitle span {
        color: rgba(204, 236, 229, 0.62);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.1em;
        white-space: nowrap;
      }
      .societySearchRow {
        min-width: 0;
        height: 32px;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 0;
        margin: 0;
        border: 1px solid rgba(74, 219, 201, 0.25);
        background: rgba(0, 14, 18, 0.62);
      }
      .societySearchRow input {
        min-width: 0;
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 0;
        outline: none;
        background: transparent;
        color: #eafff8;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
        padding: 0 8px;
      }
      .societySearchRow input::placeholder {
        color: rgba(190, 225, 216, 0.45);
      }
      .societySearchRow input:focus {
        border: 0;
        box-shadow: none;
      }
      .societySearchRow button {
        width: 34px;
        height: 100%;
        border: 0;
        border-left: 1px solid rgba(74, 219, 201, 0.22);
        border-radius: 0;
        background: transparent;
        cursor: default;
      }
      .societySearchIcon {
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        margin: 0 auto;
        border: 0;
      }
      .societySearchIcon::before {
        content: "";
        width: 11px;
        height: 11px;
        border: 2px solid #29e7e6;
        border-radius: 50%;
      }
      .societySearchIcon::after {
        right: 2px;
        bottom: 4px;
        width: 8px;
        height: 2px;
        background: #29e7e6;
      }
      .societyFilterIcon {
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        margin: 0 auto;
        border: 0;
      }
      .societyFilterIcon::before,
      .societyFilterIcon::after {
        content: "";
        position: absolute;
        background: #29e7e6;
      }
      .societyFilterIcon::before {
        width: 18px;
        height: 2px;
        top: 5px;
        left: 1px;
        box-shadow: 0 6px 0 #29e7e6, 0 12px 0 #29e7e6;
      }
      .societyFilterIcon::after {
        width: 4px;
        height: 4px;
        top: 3px;
        left: 11px;
        border-radius: 50%;
        box-shadow: -7px 6px 0 #29e7e6, 5px 12px 0 #29e7e6;
      }
      .societySpeciesList {
        min-height: 0;
        overflow: auto;
        display: grid;
        align-content: start;
        gap: 6px;
        margin: 0;
        padding-right: 4px;
      }
      .societySpeciesRow {
        min-width: 0;
        min-height: 54px;
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) 38px;
        align-items: center;
        gap: 8px;
        padding: 7px 8px;
        border: 1px solid rgba(76, 223, 197, 0.25);
        border-radius: 0;
        background: linear-gradient(90deg, rgba(8, 54, 53, 0.5), rgba(2, 22, 25, 0.64));
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .societySpeciesRow.selected,
      .societySpeciesRow:hover {
        border-color: color-mix(in srgb, var(--society-accent) 78%, rgba(255, 255, 255, 0.16));
        background: color-mix(in srgb, var(--society-accent) 14%, rgba(5, 20, 27, 0.82));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--society-accent) 20%, transparent), 0 0 14px color-mix(in srgb, var(--society-accent) 14%, transparent);
      }
      .societySpeciesIcon,
      .societyHeroIcon {
        display: grid;
        place-items: center;
        border: 1px solid rgba(74, 236, 214, 0.46);
        border-radius: 50%;
        background: rgba(11, 75, 70, 0.34);
        color: #8ffff0;
        font-weight: 950;
      }
      .societySpeciesIcon {
        width: 34px;
        height: 34px;
        font-size: 10px;
      }
      .societySpeciesCopy {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .societySpeciesCopy strong {
        overflow: hidden;
        color: #eafff8;
        font-size: 12px;
        font-weight: 950;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societySpeciesCopy small,
      .societyHero p,
      .societyTrait small,
      .societyPlanetRow small {
        color: rgba(204, 236, 229, 0.66);
        font-family: "Rajdhani", "Trebuchet MS", sans-serif;
      }
      .societySpeciesCopy small {
        overflow: hidden;
        font-size: 11px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societySpeciesMetric {
        color: #ffd66a;
        font-size: 14px;
        font-weight: 950;
        text-align: right;
      }
      .societyDetail {
        overflow: hidden;
      }
      .societyDetailScroll {
        width: 100%;
        height: 100%;
        overflow: auto;
        padding: 8px;
      }
      .societyHero {
        display: grid;
        grid-template-columns: 62px minmax(0, 1fr) minmax(250px, auto);
        min-height: 92px;
        align-items: center;
        gap: 12px;
        padding: 10px;
        background:
          radial-gradient(circle at 28% 0%, color-mix(in srgb, var(--society-accent) 12%, transparent), transparent 13rem),
          linear-gradient(90deg, rgba(8, 54, 53, 0.58), rgba(2, 22, 25, 0.68));
      }
      .societyHeroIcon {
        width: 56px;
        height: 56px;
        overflow: hidden;
        font-size: 15px;
      }
      .societyHeroIcon span {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        background:
          radial-gradient(circle at 34% 28%, rgba(118, 255, 227, 0.36), transparent 0 16%, rgba(5, 42, 48, 0.75) 17% 100%),
          conic-gradient(from 25deg, rgba(32, 255, 225, 0.24), rgba(18, 68, 82, 0.68), rgba(110, 255, 214, 0.2));
      }
      .societyHeroCopy {
        min-width: 0;
      }
      .societyHeroKicker {
        color: #70ffe5;
        font-size: 10px;
        font-weight: 950;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .societyHero h2 {
        overflow: hidden;
        margin: 2px 0;
        color: #eafff8;
        font-size: 22px;
        font-weight: 950;
        line-height: 1.05;
        letter-spacing: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societyHero p {
        max-width: 330px;
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
      }
      .societyHeroStats {
        min-width: 250px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .societyHeroStats div {
        min-width: 0;
        border-left: 1px solid rgba(76, 223, 197, 0.22);
        padding-left: 9px;
      }
      .societyHeroStats span {
        display: block;
        overflow: hidden;
        color: rgba(204, 236, 229, 0.65);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .societyHeroStats strong {
        display: block;
        margin-top: 3px;
        color: #ffffff;
        font-size: 14px;
        font-weight: 950;
        line-height: 1;
      }
      .societyGrid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(300px, 0.78fr);
        gap: 8px;
        margin-top: 8px;
      }
      .societyCard {
        min-width: 0;
        overflow: hidden;
        padding: 10px;
      }
      .societyCard.wide {
        grid-column: 1 / -1;
      }
      .societyCardTitle {
        justify-content: flex-start;
        gap: 8px;
        font-size: 13px;
      }
      .societyCardIcon {
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border: 1px solid rgba(74, 236, 214, 0.46);
        border-radius: 50%;
        background: rgba(11, 75, 70, 0.34);
        color: #8ffff0;
        font-size: 9px;
        font-weight: 950;
      }
      .societyLawStrip {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        margin: 8px 0;
      }
      .societyLawStrip span {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(82px, 0.9fr) minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-height: 32px;
        border: 1px solid rgba(76, 223, 197, 0.22);
        border-radius: 0;
        background: rgba(0, 14, 18, 0.45);
        color: rgba(230, 255, 249, 0.78);
        font-size: 10px;
        font-weight: 850;
        line-height: 1.1;
        padding: 5px 8px;
        text-transform: uppercase;
      }
      .societyLawStrip strong {
        color: #eafff8;
      }
      .societyRightsGrid {
        min-width: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }
      .societyRightSelect {
        min-width: 0;
        display: grid;
        gap: 5px;
        border: 1px solid rgba(76, 223, 197, 0.22);
        border-radius: 0;
        background: rgba(0, 14, 18, 0.45);
        color: #8ffff0;
        font-size: 10px;
        font-weight: 950;
        letter-spacing: 0.08em;
        padding: 7px;
        text-transform: uppercase;
      }
      .societyRightSelect span {
        min-width: 0;
        overflow: hidden;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societyRightSelect select {
        min-width: 0;
        width: 100%;
        height: 30px;
        min-height: 0;
        border: 1px solid rgba(177, 221, 218, 0.34);
        border-radius: 0;
        outline: none;
        appearance: none;
        background:
          linear-gradient(45deg, transparent 50%, #44f2dc 50%) right 11px center / 7px 7px no-repeat,
          linear-gradient(135deg, #44f2dc 50%, transparent 50%) right 6px center / 7px 7px no-repeat,
          rgba(3, 10, 16, 0.84);
        color: #eafff8;
        font: inherit;
        font-size: 11px;
        font-weight: 800;
        padding: 0 22px 0 8px;
        text-overflow: ellipsis;
      }
      .societyTraitList {
        display: grid;
        gap: 7px;
        margin-top: 8px;
      }
      .societyTrait {
        min-width: 0;
        min-height: 54px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px 8px;
        border: 1px solid rgba(76, 223, 197, 0.22);
        border-radius: 0;
        background: rgba(0, 14, 18, 0.45);
        padding: 8px;
      }
      .societyTrait strong {
        overflow: hidden;
        color: #eafff8;
        font-size: 13px;
        font-weight: 950;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societyTrait span {
        color: #ffd66a;
        font-size: 13px;
        font-weight: 950;
      }
      .societyTrait.negative span {
        color: #82ffe2;
      }
      .societyTrait small {
        grid-column: 1 / -1;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
      }
      .societyPlanetList {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }
      .societyPlanetRow {
        min-width: 0;
        min-height: 38px;
        display: grid;
        grid-template-columns: minmax(170px, 1fr) minmax(190px, 0.9fr) 58px;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(76, 223, 197, 0.18);
        border-radius: 0;
        background: rgba(0, 14, 18, 0.36);
        padding: 6px 8px;
      }
      .societyPlanetRow strong {
        overflow: hidden;
        display: block;
        color: #eafff8;
        font-size: 12px;
        font-weight: 950;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .societyPlanetRow small {
        display: block;
        font-size: 11px;
        font-weight: 700;
      }
      .societyPlanetBar {
        min-width: 0;
        height: 7px;
        border: 1px solid rgba(76, 223, 197, 0.18);
        background: rgba(0, 0, 0, 0.32);
      }
      .societyPlanetBar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, color-mix(in srgb, var(--society-accent) 86%, #65f2ff), #ffd66a);
      }
      .societyEmpty {
        border: 1px dashed rgba(177, 221, 218, 0.25);
        color: rgba(207, 229, 228, 0.66);
        font-size: 11px;
        font-weight: 800;
        padding: 10px;
        text-align: center;
      }
      .societyEmpty.compact {
        padding: 8px;
        text-align: left;
      }
      .societySpeciesList::-webkit-scrollbar,
      .societyDetailScroll::-webkit-scrollbar {
        width: 8px;
      }
      .societySpeciesList::-webkit-scrollbar-track,
      .societyDetailScroll::-webkit-scrollbar-track {
        background: rgba(0, 11, 15, 0.5);
      }
      .societySpeciesList::-webkit-scrollbar-thumb,
      .societyDetailScroll::-webkit-scrollbar-thumb {
        background: rgba(124, 255, 231, 0.45);
        border: 1px solid rgba(0, 0, 0, 0.4);
      }
      @media (max-width: 1260px) {
        .societyPanel {
          --society-panel-scale: 0.8;
          width: min(1120px, calc(100vw - 24px));
        }
        .societyBody {
          grid-template-columns: 270px minmax(0, 1fr);
        }
        .societyGrid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 920px) {
        .societyPanel {
          --society-panel-scale: 1;
          width: calc(100vw - 20px);
          height: calc(100vh - 82px);
        }
        .societyHeader {
          grid-template-columns: 38px minmax(0, 1fr) 36px;
          height: 56px;
          padding: 7px 10px;
        }
        .societyHeaderIcon {
          width: 34px;
          height: 34px;
        }
        .societyTitle {
          font-size: 18px;
        }
        .societyHeaderStats {
          display: none;
        }
        .societyBody {
          grid-template-columns: 1fr;
          grid-template-rows: 190px minmax(0, 1fr);
          padding: 8px;
        }
        .societyHero {
          grid-template-columns: 52px minmax(0, 1fr);
        }
        .societyHeroStats {
          grid-column: 1 / -1;
          min-width: 0;
        }
        .societyLawStrip,
        .societyRightsGrid,
        .societyPlanetRow {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
