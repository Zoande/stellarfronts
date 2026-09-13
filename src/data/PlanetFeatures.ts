import type { PlanetModifier, ResourceCounts } from "./Economy";

export type PlanetFeatureKind =
  | "homePlanet"
  | "stableFoundations"
  | "seasonalRains"
  | "shallowOreSeams"
  | "steadyWinds"
  | "fertileValleys"
  | "geothermalVents"
  | "shelteredBasins"
  | "clearSkies"
  | "magneticCalm"
  | "ancientAquifers"
  | "broadContinentalShelf"
  | "nativePollinators"
  | "mineralSprings"
  | "naturalCaverns"
  | "mildSeasons"
  | "scenicVistas"
  | "ruggedFrontier"
  | "bioluminescentFlora"
  | "mineralRichSoil"
  | "warmCurrents"
  | "tradeWinds"
  | "lowGravity"
  | "resilientEcology"
  | "naturalFiberGroves"
  | "conductiveSands"
  | "polarIceCaps"
  | "equatorialSunbelt"
  | "flashFloods"
  | "seismicFaults"
  | "radiationPockets"
  | "richMinerals"
  | "breadbasketEcosystem"
  | "planetaryPowerNexus"
  | "vastCavernNetwork"
  | "pristineBiosphere"
  | "ancientRuins"
  | "strategicCrossroads"
  | "livingOcean"
  | "crystallinePlateaus"
  | "superconductiveMantle"
  | "ecumenicFoundations"
  | "colossalFauna"
  | "harmonicMagnetosphere"
  | "volatileTectonics"
  | "hostileBiosphere"
  | "toxicAtmosphere"
  | "perpetualStorms"
  | "irradiatedWastes"
  | "shatteredCrust";

export type PlanetFeatureTier = "minor" | "major" | "special";
export type PlanetFeatureRarity = "common" | "uncommon" | "rare" | "veryRare";

export type PlanetFeaturePlanetType =
  | "Barren" | "Gaseous" | "Snowy" | "Arid" | "Dusty" | "Grassland"
  | "Jungle" | "Marshy" | "Martian" | "Methane" | "Sandy" | "Tundra";

export type PlanetFeatureStarType =
  | "B" | "A" | "F" | "G" | "K" | "M" | "M Red Giant" | "T Brown Dwarf"
  | "Neutron Star" | "Pulsar" | "Black Hole";

export interface PlanetFeatureRemovalDefinition {
  cost: ResourceCounts;
  buildDays: number;
}

export interface PlanetFeatureDefinition {
  kind: PlanetFeatureKind;
  label: string;
  initials: string;
  description: string;
  tier: PlanetFeatureTier;
  rarity: PlanetFeatureRarity;
  weight: number;
  negative: boolean;
  planetTypes?: readonly PlanetFeaturePlanetType[];
  starTypes?: readonly PlanetFeatureStarType[];
  modifiers: PlanetModifier[];
  removal?: PlanetFeatureRemovalDefinition;
}

type ModifierSpec = readonly [
  target: PlanetModifier["target"],
  operation: PlanetModifier["operation"],
  value: number,
];

type FeatureOptions = Partial<Pick<
  PlanetFeatureDefinition,
  "initials" | "negative" | "planetTypes" | "starTypes" | "removal"
>>;

const rarityWeights: Record<PlanetFeatureRarity, number> = {
  common: 10,
  uncommon: 6,
  rare: 3,
  veryRare: 1,
};

const resourceCost = (
  minerals: number,
  energy = 0,
  goods = 0,
  alloys = 0,
  research = 0,
  food = 0,
): ResourceCounts => ({ food, minerals, energy, goods, alloys, research });

const remediation = (
  minerals: number,
  energy: number,
  buildDays: number,
  goods = 0,
  alloys = 0,
): PlanetFeatureRemovalDefinition => ({
  cost: resourceCost(minerals, energy, goods, alloys),
  buildDays,
});

function defineFeature(
  kind: PlanetFeatureKind,
  label: string,
  tier: PlanetFeatureTier,
  rarity: PlanetFeatureRarity,
  description: string,
  modifiers: readonly ModifierSpec[],
  options: FeatureOptions = {},
): PlanetFeatureDefinition {
  const initials = options.initials ?? label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return {
    kind,
    label,
    initials,
    description,
    tier,
    rarity,
    weight: rarityWeights[rarity],
    negative: options.negative ?? false,
    planetTypes: options.planetTypes,
    starTypes: options.starTypes,
    removal: options.removal,
    modifiers: modifiers.map(([target, operation, value], index) => ({
      id: `feature-${kind}-${index + 1}`,
      label,
      source: `planetFeature:${kind}`,
      target,
      operation,
      value,
    })),
  };
}

const minor = (
  kind: PlanetFeatureKind,
  label: string,
  rarity: PlanetFeatureRarity,
  description: string,
  modifiers: readonly ModifierSpec[],
  options?: FeatureOptions,
) => defineFeature(kind, label, "minor", rarity, description, modifiers, options);

const major = (
  kind: PlanetFeatureKind,
  label: string,
  rarity: PlanetFeatureRarity,
  description: string,
  modifiers: readonly ModifierSpec[],
  options?: FeatureOptions,
) => defineFeature(kind, label, "major", rarity, description, modifiers, options);

const ROCKY: readonly PlanetFeaturePlanetType[] = ["Barren", "Snowy", "Arid", "Dusty", "Grassland", "Jungle", "Marshy", "Martian", "Sandy", "Tundra"];
const WET: readonly PlanetFeaturePlanetType[] = ["Grassland", "Jungle", "Marshy"];
const DRY: readonly PlanetFeaturePlanetType[] = ["Arid", "Dusty", "Martian", "Sandy"];
const COLD: readonly PlanetFeaturePlanetType[] = ["Snowy", "Tundra"];
const MAIN_SEQUENCE: readonly PlanetFeatureStarType[] = ["B", "A", "F", "G", "K", "M"];
const HOT_STARS: readonly PlanetFeatureStarType[] = ["B", "A", "F"];
const COMPACT_STARS: readonly PlanetFeatureStarType[] = ["Neutron Star", "Pulsar", "Black Hole"];

const definitions: PlanetFeatureDefinition[] = [
  // Thirty minor features. Minor effects are intentionally narrow and are grouped in the planet hero.
  minor("stableFoundations", "Stable Foundations", "common", "Deep, coherent bedrock supports denser urban construction.", [["districtLimit:city", "add", 2]], { planetTypes: ROCKY }),
  minor("seasonalRains", "Seasonal Rains", "common", "Predictable rainfall opens additional land to dependable cultivation.", [["districtLimit:agriculture", "add", 2]], { planetTypes: WET }),
  minor("shallowOreSeams", "Shallow Ore Seams", "common", "Accessible mineral seams make additional mining zones practical.", [["districtLimit:mining", "add", 2]], { planetTypes: ROCKY }),
  minor("steadyWinds", "Steady Winds", "common", "Persistent atmospheric circulation supports extra power districts.", [["districtLimit:generator", "add", 2]], { planetTypes: [...DRY, "Gaseous"] }),
  minor("fertileValleys", "Fertile Valleys", "common", "Rich alluvial valleys improve the yield of ordinary farms.", [["jobOutput:farmer:food", "multiply", 0.1]], { planetTypes: WET }),
  minor("geothermalVents", "Geothermal Vents", "uncommon", "Stable geothermal sources supplement planetary power generation.", [["jobOutput:technician:energy", "multiply", 0.1]], { planetTypes: ROCKY }),
  minor("shelteredBasins", "Sheltered Basins", "uncommon", "Naturally protected settlement basins provide inexpensive living space.", [["housing", "add", 500_000_000]], { planetTypes: ROCKY }),
  minor("clearSkies", "Clear Skies", "uncommon", "Low atmospheric interference aids observatories and field laboratories.", [["jobOutput:researcher:research", "multiply", 0.08]], { planetTypes: ["Arid", "Sandy", "Grassland"], starTypes: ["F", "G", "K"] }),
  minor("magneticCalm", "Magnetic Calm", "rare", "An unusually quiet magnetosphere simplifies infrastructure and navigation.", [["constructionSpeed", "multiply", 0.05]]),
  minor("ancientAquifers", "Ancient Aquifers", "uncommon", "Deep water reserves sustain growing settlements and farms.", [["planetCapacity", "add", 750_000_000], ["districtLimit:agriculture", "add", 1]], { planetTypes: [...DRY, ...COLD] }),
  minor("broadContinentalShelf", "Broad Continental Shelf", "uncommon", "Shallow coastal regions offer productive and accessible terrain.", [["districtLimit:agriculture", "add", 1], ["housing", "add", 250_000_000]], { planetTypes: WET }),
  minor("nativePollinators", "Native Pollinators", "rare", "Compatible native pollinators raise cultivated crop yields.", [["jobOutput:farmer:food", "multiply", 0.15]], { planetTypes: WET }),
  minor("mineralSprings", "Mineral Springs", "uncommon", "Mineral-bearing springs concentrate useful deposits near the surface.", [["jobOutput:miner:minerals", "multiply", 0.08]], { planetTypes: ROCKY }),
  minor("naturalCaverns", "Natural Caverns", "uncommon", "Large stable caverns ease excavation and protected construction.", [["districtConstructionSpeed", "multiply", 0.1]], { planetTypes: ROCKY }),
  minor("mildSeasons", "Mild Seasons", "common", "A restrained seasonal cycle improves comfort and demographic growth.", [["happiness", "add", 3], ["populationGrowth", "multiply", 0.05]], { planetTypes: ["Grassland", "Marshy", "Tundra", "Gaseous", "Methane"] }),
  minor("scenicVistas", "Scenic Vistas", "uncommon", "Striking landscapes make the colony a desirable destination.", [["amenities", "add", 8], ["migrationAttractiveness", "add", 8]]),
  minor("ruggedFrontier", "Rugged Frontier", "common", "Challenging but open terrain attracts determined settlers, though construction is slower.", [["migrationAttractiveness", "add", 10], ["constructionSpeed", "multiply", -0.03]], { negative: true }),
  minor("bioluminescentFlora", "Bioluminescent Flora", "rare", "Native light-producing organisms reward sustained biological study.", [["jobOutput:researcher:research", "multiply", 0.12]], { planetTypes: ["Jungle", "Marshy"] }),
  minor("mineralRichSoil", "Mineral-Rich Soil", "uncommon", "Trace minerals strengthen local crops and simplify fertilization.", [["jobOutput:farmer:food", "multiply", 0.08], ["popUpkeep:food", "multiply", -0.03]], { planetTypes: ["Grassland", "Jungle", "Marshy", "Arid"] }),
  minor("warmCurrents", "Warm Currents", "uncommon", "Stable warm currents moderate coastal climates and ecosystems.", [["populationGrowth", "multiply", 0.08], ["migrationAttractiveness", "add", 5]], { planetTypes: WET }),
  minor("tradeWinds", "Trade Winds", "uncommon", "Regular high-altitude currents make regional transport dependable.", [["buildingConstructionSpeed", "multiply", 0.08], ["migrationIntakeCapacity", "add", 5_000_000]], { planetTypes: [...DRY, "Grassland", "Gaseous", "Methane"] }),
  minor("lowGravity", "Low Gravity", "rare", "Reduced surface gravity lowers structural loads and transport costs.", [["constructionSpeed", "multiply", 0.1], ["housing", "add", 250_000_000]], { planetTypes: ["Barren", "Snowy", "Martian", "Tundra"] }),
  minor("resilientEcology", "Resilient Ecology", "rare", "Local ecosystems recover quickly from settlement disruption.", [["populationGrowth", "multiply", 0.08], ["stability", "add", 3]], { planetTypes: WET }),
  minor("naturalFiberGroves", "Natural Fiber Groves", "rare", "Native fibers provide useful feedstock for civilian manufacturing.", [["jobOutput:artisan:goods", "multiply", 0.1]], { planetTypes: ["Grassland", "Jungle"] }),
  minor("conductiveSands", "Conductive Sands", "rare", "Metallic sands enable efficient power routing but make exposed settlement hazardous.", [["jobOutput:technician:energy", "multiply", 0.12], ["habitability:human", "add", -3]], { negative: true, planetTypes: ["Sandy", "Dusty", "Arid"], starTypes: HOT_STARS }),
  minor("polarIceCaps", "Polar Ice Caps", "uncommon", "Accessible polar reserves provide water and thermal stability.", [["planetCapacity", "add", 500_000_000], ["migrationIntakeCapacity", "add", 4_000_000]], { planetTypes: COLD }),
  minor("equatorialSunbelt", "Equatorial Sunbelt", "rare", "A broad equatorial band receives unusually reliable stellar energy.", [["districtLimit:generator", "add", 2], ["jobOutput:technician:energy", "multiply", 0.05]], { planetTypes: ROCKY, starTypes: HOT_STARS }),
  minor("flashFloods", "Flash Floods", "common", "Sudden floods repeatedly damage farms and transport routes.", [["jobOutput:farmer:food", "multiply", -0.1], ["districtConstructionSpeed", "multiply", -0.05]], { negative: true, planetTypes: WET, removal: remediation(350, 200, 240) }),
  minor("seismicFaults", "Seismic Faults", "uncommon", "Active faults complicate urban expansion and heavy construction.", [["districtLimit:city", "add", -1], ["constructionSpeed", "multiply", -0.08]], { negative: true, planetTypes: ROCKY, removal: remediation(500, 300, 360, 50, 25) }),
  minor("radiationPockets", "Radiation Pockets", "rare", "Localized radiation zones reduce usable land and settlement safety.", [["habitability:human", "add", -5], ["planetCapacity", "add", -250_000_000]], { negative: true, starTypes: COMPACT_STARS, removal: remediation(450, 450, 300, 75) }),

  // Twenty major-slot features, including the special Home Planet feature.
  defineFeature("homePlanet", "Home Planet", "special", "veryRare", "The species' cradle world, with familiar biospheres, culture, infrastructure, and settlement patterns.", [["habitability:human", "add", 20]], { initials: "HP" }),
  major("richMinerals", "Rich Minerals", "uncommon", "Exceptional deposits support a large and highly productive extraction sector.", [["jobOutput:miner:minerals", "multiply", 0.33], ["districtLimit:mining", "add", 5]], { planetTypes: ROCKY, initials: "RM" }),
  major("breadbasketEcosystem", "Breadbasket Ecosystem", "uncommon", "Vast naturally fertile regions can feed populations far beyond this world.", [["jobOutput:farmer:food", "multiply", 0.3], ["districtLimit:agriculture", "add", 5]], { planetTypes: WET, initials: "BE" }),
  major("planetaryPowerNexus", "Planetary Power Nexus", "rare", "The planet's climate and geology are exceptionally suited to energy production.", [["jobOutput:technician:energy", "multiply", 0.3], ["districtLimit:generator", "add", 5]], { planetTypes: [...DRY, "Gaseous", "Methane"], initials: "PN" }),
  major("vastCavernNetwork", "Vast Cavern Network", "rare", "A continent-spanning cavern system offers protected room for expansion.", [["districtLimit:city", "add", 4], ["housing", "add", 1_000_000_000]], { planetTypes: ROCKY, initials: "VC" }),
  major("pristineBiosphere", "Pristine Biosphere", "veryRare", "An exceptionally compatible biosphere supports health, growth, and settlement.", [["habitability:human", "add", 15], ["populationGrowth", "multiply", 0.15], ["planetCapacity", "add", 1_000_000_000]], { planetTypes: WET, initials: "PB" }),
  major("ancientRuins", "Ancient Ruins", "rare", "Enigmatic ruins provide a continuing stream of scientific discoveries.", [["jobOutput:researcher:research", "multiply", 0.25], ["districtLimit:city", "add", 2]], { planetTypes: ROCKY, initials: "AR" }),
  major("strategicCrossroads", "Strategic Crossroads", "rare", "Natural orbital geometry and accessible terrain make this world a logistical hub.", [["constructionSpeed", "multiply", 0.2], ["migrationAttractiveness", "add", 20], ["migrationIntakeCapacity", "add", 15_000_000]], { initials: "SC" }),
  major("livingOcean", "Living Ocean", "veryRare", "A planet-spanning living ocean continually renews its immense biological wealth.", [["jobOutput:farmer:food", "multiply", 0.25], ["jobOutput:researcher:research", "multiply", 0.15], ["planetCapacity", "add", 1_500_000_000]], { planetTypes: ["Marshy", "Jungle"], initials: "LO" }),
  major("crystallinePlateaus", "Crystalline Plateaus", "rare", "Vast crystalline formations contain valuable ores and unusual physical structures.", [["jobOutput:miner:minerals", "multiply", 0.2], ["jobOutput:researcher:research", "multiply", 0.15], ["districtLimit:mining", "add", 3]], { planetTypes: ROCKY, starTypes: ["Neutron Star", "Pulsar"], initials: "CP" }),
  major("superconductiveMantle", "Superconductive Mantle", "veryRare", "Unusual mantle chemistry permits extraordinarily efficient planetary energy grids.", [["jobOutput:technician:energy", "multiply", 0.35], ["districtLimit:generator", "add", 4]], { planetTypes: ROCKY, starTypes: ["Neutron Star", "Pulsar", "T Brown Dwarf"], initials: "SM" }),
  major("ecumenicFoundations", "Ecumenic Foundations", "veryRare", "Stable continental shelves and deep bedrock favor enormous urban complexes.", [["districtLimit:city", "add", 6], ["buildingConstructionSpeed", "multiply", 0.2], ["housing", "add", 1_500_000_000]], { planetTypes: ["Barren", "Arid", "Grassland", "Martian"], initials: "EF" }),
  major("colossalFauna", "Colossal Fauna", "rare", "Immense native organisms inspire research and draw migrants despite settlement risks.", [["jobOutput:researcher:research", "multiply", 0.2], ["migrationAttractiveness", "add", 15], ["stability", "add", -3]], { negative: true, planetTypes: ["Grassland", "Jungle", "Marshy"], initials: "CF" }),
  major("harmonicMagnetosphere", "Harmonic Magnetosphere", "veryRare", "A resonant magnetosphere stabilizes power transmission and shields surface activity.", [["jobOutput:technician:energy", "multiply", 0.2], ["habitability:human", "add", 10], ["stability", "add", 5]], { starTypes: MAIN_SEQUENCE, initials: "HM" }),
  major("volatileTectonics", "Volatile Tectonics", "uncommon", "Frequent crustal movement damages infrastructure and closes productive terrain.", [["constructionSpeed", "multiply", -0.2], ["districtLimit:city", "add", -2], ["stability", "add", -5]], { negative: true, planetTypes: ROCKY, removal: remediation(1200, 600, 720, 150, 100), initials: "VT" }),
  major("hostileBiosphere", "Hostile Biosphere", "uncommon", "Aggressive native life resists settlement and disrupts food production.", [["habitability:human", "add", -12], ["jobOutput:farmer:food", "multiply", -0.2], ["crime", "add", 5]], { negative: true, planetTypes: WET, removal: remediation(800, 450, 540, 200), initials: "HB" }),
  major("toxicAtmosphere", "Toxic Atmosphere", "rare", "Persistent airborne toxins require extensive containment and medical support.", [["habitability:human", "add", -15], ["popUpkeep:goods", "multiply", 0.15], ["populationGrowth", "multiply", -0.1]], { negative: true, planetTypes: ["Methane", "Gaseous", "Dusty", "Martian"], removal: remediation(1000, 800, 660, 250, 75), initials: "TA" }),
  major("perpetualStorms", "Perpetual Storms", "rare", "Planet-wide storm systems obstruct transport, construction, and agriculture.", [["constructionSpeed", "multiply", -0.2], ["jobOutput:farmer:food", "multiply", -0.15], ["migrationAttractiveness", "add", -15]], { negative: true, planetTypes: ["Gaseous", "Marshy", "Jungle", "Methane"], initials: "PS" }),
  major("irradiatedWastes", "Irradiated Wastes", "rare", "Large regions remain dangerous after prolonged exposure to extreme stellar radiation.", [["habitability:human", "add", -20], ["planetCapacity", "add", -1_000_000_000], ["districtLimit:agriculture", "add", -3]], { negative: true, starTypes: COMPACT_STARS, removal: remediation(1400, 1200, 840, 300, 150), initials: "IW" }),
  major("shatteredCrust", "Shattered Crust", "veryRare", "The planet's broken crust severely limits safe construction and extraction.", [["districtLimit:city", "add", -3], ["districtLimit:mining", "add", -2], ["districtConstructionSpeed", "multiply", -0.25]], { negative: true, planetTypes: ["Barren", "Martian", "Dusty"], removal: remediation(1800, 900, 960, 250, 250), initials: "SK" }),
];

export const PLANET_FEATURE_DEFINITIONS = Object.fromEntries(
  definitions.map((definition) => [definition.kind, definition]),
) as Record<PlanetFeatureKind, PlanetFeatureDefinition>;

export const PLANET_FEATURE_KINDS = definitions.map((definition) => definition.kind);
export const PLANET_MINOR_FEATURE_KINDS = definitions.filter((definition) => definition.tier === "minor").map((definition) => definition.kind);
export const PLANET_MAJOR_FEATURE_KINDS = definitions.filter((definition) => definition.tier !== "minor").map((definition) => definition.kind);
export const PLANET_FEATURE_GENERATION_VERSION = 1;

export function isPlanetFeatureKind(value: unknown): value is PlanetFeatureKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLANET_FEATURE_DEFINITIONS, value);
}

export function isPlanetFeatureEligible(
  definition: PlanetFeatureDefinition,
  planetType: string,
  starType: string,
): boolean {
  return (!definition.planetTypes || definition.planetTypes.includes(planetType as PlanetFeaturePlanetType))
    && (!definition.starTypes || definition.starTypes.includes(starType as PlanetFeatureStarType));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedSample(
  pool: PlanetFeatureDefinition[],
  count: number,
  random: () => number,
): PlanetFeatureKind[] {
  const remaining = [...pool];
  const selected: PlanetFeatureKind[] = [];
  while (remaining.length > 0 && selected.length < count) {
    const totalWeight = remaining.reduce((sum, definition) => sum + definition.weight, 0);
    let roll = random() * totalWeight;
    let selectedIndex = remaining.length - 1;
    for (let index = 0; index < remaining.length; index += 1) {
      roll -= remaining[index].weight;
      if (roll <= 0) {
        selectedIndex = index;
        break;
      }
    }
    selected.push(remaining[selectedIndex].kind);
    remaining.splice(selectedIndex, 1);
  }
  return selected;
}

export interface PlanetFeatureGenerationInput {
  planetId: string;
  planetType: string;
  starType: string;
  isHomePlanet?: boolean;
}

export function generatePlanetFeatures(input: PlanetFeatureGenerationInput): PlanetFeatureKind[] {
  const random = mulberry32(hashString(`${input.planetId}:${input.planetType}:${input.starType}:features-v${PLANET_FEATURE_GENERATION_VERSION}`));
  const minorCount = 2 + Math.floor(random() * 4);
  const requestedMajorCount = Math.floor(random() * 4);
  const majorCount = Math.max(0, Math.min(input.isHomePlanet ? 2 : 3, requestedMajorCount));
  const eligible = definitions.filter((definition) => (
    definition.kind !== "homePlanet"
    && isPlanetFeatureEligible(definition, input.planetType, input.starType)
  ));
  const majors = weightedSample(eligible.filter((definition) => definition.tier === "major"), majorCount, random);
  const minors = weightedSample(eligible.filter((definition) => definition.tier === "minor"), minorCount, random);
  return [...(input.isHomePlanet ? ["homePlanet" as const] : []), ...majors, ...minors];
}
