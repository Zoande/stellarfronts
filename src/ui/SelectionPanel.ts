/**
 * SelectionPanel
 * Displays detail panels for selected ship or starbase in bottom-right
 */

import type {
  FleetDoctrine,
  FleetEngagementRule,
  FleetRetreatPreset,
} from "../game/CombatTypes";
import type { LeaderState } from "../data/Leaders";
import { GAME_DAYS_PER_YEAR, gameYearToDateTime } from "../game/GameTime";
import type { ShipAction } from "../game/GameplayTypes";
import { requestOpenLeadersPanel } from "./leaderEvents";

export type SelectionType = "ship" | "fleet" | "starbase";
export type FleetPolicyControl = "engagementRule" | "doctrine" | "retreatPreset";
export type FleetPolicyValue = FleetEngagementRule | FleetDoctrine | FleetRetreatPreset;

export interface SelectionRepairTarget {
  fleetId: string;
  label: string;
}

export interface SelectionShipData {
  id: string;
  shipKind?: string;
  name: string;
  designName: string;
  className: string;
  shield: number;
  maxShield: number;
  armor: number;
  maxArmor: number;
  hull: number;
  maxHull: number;
  ownerColor?: [number, number, number];
}

export interface SelectionMovementData {
  destination: string;
  startedYear: number;
  arrivalYear: number;
  darkMatterBoostActive?: boolean;
}

export interface SelectionData {
  type: SelectionType;
  id?: string;
  readoutId?: string;
  name: string;
  hp: number;
  maxHp: number;
  shield?: number;
  maxShield?: number;
  armor?: number;
  maxArmor?: number;
  hull?: number;
  maxHull?: number;
  class?: string;
  status?: string;
  detail?: string;
  ownerName?: string;
  ownerColor?: [number, number, number];
  canCommand?: boolean;
  actions?: ShipAction[];
  ships?: SelectionShipData[];
  shipCount?: number;
  movement?: SelectionMovementData;
  engagementRule?: FleetEngagementRule;
  doctrine?: FleetDoctrine;
  retreatPreset?: FleetRetreatPreset;
  repairTargets?: SelectionRepairTarget[];
  activeRepairTargetFleetId?: string | null;
  repairStatus?: string | null;
  leader?: LeaderState | null;
}

export interface SelectionPanelCallbacks {
  onShipAction?: (action: ShipAction, selection?: SelectionData) => void;
  onFleetPolicyChange?: (control: FleetPolicyControl, value: FleetPolicyValue, selection?: SelectionData) => void;
  onRepairFleet?: (constructionFleetId: string, targetFleetId: string) => void;
}

export class SelectionPanel {
  private root: HTMLDivElement;
  private selections: Map<string, SelectionData> = new Map();
  private styleId = "space-selection-panel-style";
  private containerElement: HTMLDivElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private activeShipAction: ShipAction | null = null;
  private activePolicyPicker: { selectionKey: string; control: FleetPolicyControl } | null = null;
  private clockYear = 2100;
  private callbacks: SelectionPanelCallbacks;

  constructor(canvasElement?: HTMLCanvasElement, callbacks: SelectionPanelCallbacks = {}) {
    this.root = document.getElementById("spaceHudRoot") as HTMLDivElement;
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "spaceHudRoot";
      document.body.appendChild(this.root);
    }
    this.canvasElement = canvasElement || (document.querySelector("canvas") as HTMLCanvasElement);
    this.callbacks = callbacks;
    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById(this.styleId)) return;

    const style = document.createElement("style");
    style.id = this.styleId;
    style.textContent = `
.spaceSelectionPanelContainer {
  position: fixed;
  bottom: 16px;
  left: 6px;
  display: flex;
  flex-direction: column-reverse;
  gap: 12px;
  max-width: calc(100vw - 12px);
  max-height: calc(100vh - 32px);
  overflow: visible;
  padding-right: 6px;
  pointer-events: auto;
  z-index: 49;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}

.spaceSelectionPanel {
  --selection-color: rgba(150, 200, 230, 0.95);
  --selection-color-soft: rgba(150, 200, 230, 0.22);
  min-width: 240px;
  border-radius: 6px;
  border: 1px solid var(--selection-color);
  background:
    linear-gradient(180deg, var(--selection-color-soft) 0%, rgba(6, 13, 24, 0.1) 36%),
    linear-gradient(180deg, var(--hud-panel-alt) 0%, var(--hud-panel) 100%);
  padding: 12px;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  color: var(--hud-ink);
  font-size: 11px;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}

.spaceSelectionPanel.starbase {
  border-color: rgba(230, 200, 150, 0.7);
}

.spaceSelectionPanel.ship,
.spaceSelectionPanel.fleet {
  border-color: var(--selection-color);
}

.spaceSelectionPanelTitle {
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 12px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--hud-line);
}

.spaceSelectionPanel.starbase .spaceSelectionPanelTitle {
  color: rgba(230, 200, 150, 0.95);
}

.spaceSelectionPanel.ship .spaceSelectionPanelTitle,
.spaceSelectionPanel.fleet .spaceSelectionPanelTitle {
  color: var(--selection-color);
}

.spaceSelectionPanelContent {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.spaceSelectionPanelRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.spaceSelectionPanelLabel {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex: 1;
}

.spaceSelectionPanelValue {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: right;
  min-width: 60px;
}

.spaceSelectionPanelHpBar {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  border: 1px solid var(--hud-line);
  overflow: hidden;
  margin-top: 6px;
}

.spaceSelectionPanelHpFill {
  height: 100%;
  background: linear-gradient(90deg, rgba(100, 200, 100, 0.8), rgba(80, 180, 80, 0.9));
  border-radius: 1px;
  transition: width 0.2s ease;
}

.spaceSelectionPanel.ship .spaceSelectionPanelHpFill,
.spaceSelectionPanel.fleet .spaceSelectionPanelHpFill {
  background: linear-gradient(90deg, var(--selection-color-soft), var(--selection-color));
}

.spaceSelectionPanelHpPercent {
  font-size: 9px;
  color: var(--hud-muted);
  margin-top: 2px;
  text-align: right;
  letter-spacing: 0.08em;
}

.spaceSelectionPanelLayerStack {
  display: grid;
  gap: 4px;
  margin-top: 6px;
}

.spaceSelectionPanelLayerBar {
  width: 100%;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  border: 1px solid var(--hud-line);
  overflow: hidden;
}

.spaceSelectionPanelLayerFill {
  height: 100%;
  border-radius: 1px;
  transition: width 0.2s ease;
}

.spaceSelectionPanelLayerFill.shield {
  background: linear-gradient(90deg, rgba(78, 160, 220, 0.55), rgba(86, 202, 255, 0.9));
}

.spaceSelectionPanelLayerFill.armor {
  background: linear-gradient(90deg, rgba(210, 145, 84, 0.6), rgba(255, 190, 122, 0.92));
}

.spaceSelectionPanelLayerFill.hull {
  background: linear-gradient(90deg, rgba(120, 200, 120, 0.6), rgba(90, 210, 150, 0.95));
}

.spaceSelectionPanelDetail {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1.35;
}

.spaceSelectionActions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.spaceSelectionActionBtn {
  min-height: 30px;
  border-radius: 4px;
  border: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(29, 38, 49, 0.96) 0%, rgba(18, 25, 33, 0.96) 100%);
  color: #c4d1e2;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.spaceSelectionActionBtn:hover {
  border-color: var(--selection-color);
  background: linear-gradient(180deg, rgba(37, 52, 68, 0.98) 0%, rgba(22, 33, 44, 0.98) 100%);
}

.spaceSelectionActionBtn.active {
  border-color: var(--selection-color);
  color: #edfaff;
  box-shadow: 0 0 16px var(--selection-color-soft);
}

.spaceSelectionPanel.fleet {
  --fleet-panel-width: min(560px, calc(100vw - 18px));
  position: relative;
  width: var(--fleet-panel-width);
  min-width: 0;
  height: 236px;
  padding: 0;
  border-radius: 4px;
  border-color: var(--selection-color);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0) 21%),
    radial-gradient(circle at 18% 6%, var(--selection-color-soft), transparent 16rem),
    linear-gradient(180deg, rgba(10, 13, 24, 0.92), rgba(5, 8, 14, 0.9));
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.46),
    inset 0 0 0 1px rgba(255, 255, 255, 0.035);
  overflow: visible;
}

.fleetSelectionTopStrip {
  height: 43px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 6px;
  border-bottom: 1px solid rgba(155, 178, 205, 0.18);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.035), transparent);
}

.fleetSelectionToolBtn,
.fleetSelectionPrimaryBtn,
.fleetSelectionPolicyBtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 3px;
  border: 1px solid rgba(188, 99, 181, 0.46);
  background: rgba(18, 17, 31, 0.78);
  color: #dce7f2;
  font-family: inherit;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.fleetSelectionToolBtn:disabled,
.fleetSelectionPrimaryBtn:disabled,
.fleetSelectionPolicyBtn:disabled {
  cursor: default;
  opacity: 0.42;
}

.fleetSelectionToolBtn:not(:disabled):hover,
.fleetSelectionPrimaryBtn:not(:disabled):hover,
.fleetSelectionPolicyBtn:not(:disabled):hover {
  border-color: rgba(255, 129, 236, 0.92);
  box-shadow: 0 0 16px rgba(242, 82, 210, 0.24);
}

.fleetSelectionToolBtn svg,
.fleetSelectionPrimaryBtn svg,
.fleetSelectionPolicyBtn svg {
  width: 17px;
  height: 17px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fleetSelectionToolBtn {
  width: 44px;
  height: 27px;
  padding: 0;
  font-size: 9px;
}

.fleetSelectionToolBtn.retreatText {
  width: 79px;
  color: #f4dde9;
  font-size: 9px;
}

.fleetSelectionToolBtn.stop {
  color: #ffd9d6;
  border-color: rgba(255, 112, 122, 0.58);
  background: rgba(36, 13, 18, 0.76);
}

.fleetSelectionToolBtn.darkMatterBoost {
  color: #dba3ff;
  border-color: rgba(194, 88, 255, 0.62);
  background: linear-gradient(145deg, rgba(67, 19, 96, 0.86), rgba(24, 10, 43, 0.86));
}

.fleetSelectionToolBtn.darkMatterBoost.active {
  color: #fff;
  border-color: rgba(228, 161, 255, 0.98);
  box-shadow: 0 0 14px rgba(195, 72, 255, 0.64), inset 0 0 10px rgba(225, 153, 255, 0.15);
}

.fleetSelectionTopMeta {
  margin-left: auto;
  align-self: flex-end;
  padding-bottom: 1px;
  color: rgba(195, 208, 226, 0.62);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.07em;
  white-space: nowrap;
}

.fleetSelectionBody {
  position: relative;
  height: calc(100% - 43px);
  display: grid;
  grid-template-columns: minmax(236px, 0.86fr) minmax(286px, 1.14fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px 10px;
  padding: 8px 12px 10px;
}

.fleetSelectionIdentity {
  min-width: 0;
  overflow: hidden;
}

.fleetSelectionTitle {
  color: var(--selection-color);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fleetSelectionIdentityGrid {
  display: grid;
  grid-template-columns: 124px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  min-width: 0;
}

.fleetSelectionLeaderCard {
  width: 124px;
  min-width: 0;
  height: 62px;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(236, 248, 244, 0.9);
  font: inherit;
  text-align: left;
  cursor: default;
  overflow: visible;
}

.fleetSelectionLeaderCard.assignable {
  cursor: pointer;
}

.fleetSelectionLeaderCard.assignable:hover {
  color: #dffff5;
}

.fleetSelectionLeaderCard strong {
  display: block;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.fleetSelectionLeaderText span {
  display: block;
  margin-top: 3px;
  color: rgba(218, 236, 229, 0.72);
  font-size: 9px;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.fleetSelectionLeaderPortrait {
  flex: 0 0 auto;
  width: 52px;
  height: 62px;
  overflow: hidden;
  background: transparent;
  border: 0;
  display: grid;
  place-items: center;
  color: rgba(230, 255, 246, 0.88);
  font-size: 13px;
  font-weight: 900;
}

.fleetSelectionLeaderPortrait img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  object-position: center top;
  transform: scale(2.08);
  transform-origin: 50% 6%;
  filter: drop-shadow(0 4px 4px rgba(0, 0, 0, 0.78));
  pointer-events: none;
}

.fleetSelectionLeaderCard.assignable:hover .fleetSelectionLeaderPortrait img {
  filter: drop-shadow(0 4px 5px rgba(70, 238, 191, 0.4)) drop-shadow(0 4px 4px rgba(0, 0, 0, 0.78));
}

.fleetSelectionLeaderPortrait span {
  margin: 0;
  color: rgba(230, 255, 246, 0.86);
  font-size: 13px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.95);
}

.fleetSelectionLeaderPortrait i {
  display: grid;
  place-items: center;
  color: rgba(179, 255, 229, 0.95);
  font-style: normal;
  font-size: 21px;
  line-height: 1;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.95);
}

.fleetSelectionLeaderText {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  padding-bottom: 7px;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.92));
}

.fleetSelectionMetaRows {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.fleetSelectionMetaRow {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}

.fleetSelectionMetaRow span:first-child {
  color: rgba(191, 205, 221, 0.66);
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.fleetSelectionMetaRow span:last-child {
  color: rgba(237, 247, 255, 0.92);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1.15;
  text-align: left;
  white-space: normal;
  overflow-wrap: anywhere;
}

.fleetSelectionMovement {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 8px;
  padding: 4px 6px 5px;
  border: 1px solid rgba(154, 111, 211, 0.3);
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(34, 17, 54, 0.52), rgba(10, 13, 24, 0.68));
  pointer-events: none;
  overflow: hidden;
}

.fleetSelectionMovementRow {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
}

.fleetSelectionMovementRow.destination {
  grid-column: 1 / -1;
}

.fleetSelectionMovementRow span {
  color: rgba(191, 205, 221, 0.66);
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}

.fleetSelectionMovementRow strong {
  min-width: 0;
  color: rgba(237, 247, 255, 0.92);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.02em;
  line-height: 1.16;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fleetSelectionMovementProgress {
  grid-column: 1 / -1;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(143, 162, 190, 0.18);
}

.fleetSelectionMovementProgress i {
  display: block;
  width: var(--movement-progress, 0%);
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7138ce, #d77bff);
  box-shadow: 0 0 7px rgba(203, 94, 255, 0.72);
}

.fleetSelectionCommandLower {
  min-width: 0;
  display: grid;
  grid-template-columns: 98px minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}

.fleetSelectionCommandStack {
  min-width: 0;
  display: grid;
  grid-template-rows: 39px auto auto;
  gap: 8px;
  align-content: start;
}

.fleetSelectionPrimaryRow,
.fleetSelectionPolicyRow {
  display: grid;
  gap: 8px;
}

.fleetSelectionPrimaryRow {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.fleetSelectionPrimaryBtn {
  min-width: 0;
  height: 39px;
  padding: 0 12px;
  font-size: 10px;
}

.fleetSelectionPrimaryBtn.move {
  color: #8cd9ff;
  border-color: rgba(64, 170, 230, 0.6);
  background: linear-gradient(180deg, rgba(20, 68, 93, 0.7), rgba(10, 33, 50, 0.76));
}

.fleetSelectionPrimaryBtn.attack {
  color: #ff8a93;
  border-color: rgba(230, 67, 88, 0.64);
  background: linear-gradient(180deg, rgba(78, 25, 35, 0.72), rgba(38, 12, 20, 0.78));
}

.fleetSelectionRepairRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}

.fleetSelectionRepairRow select,
.fleetSelectionRepairRow button {
  min-width: 0;
  height: 26px;
  border: 1px solid rgba(82, 221, 171, 0.48);
  border-radius: 3px;
  background: rgba(5, 28, 24, 0.88);
  color: #a9f4d4;
  font: 800 8px "Orbitron", sans-serif;
}

.fleetSelectionRepairRow button { padding: 0 8px; cursor: pointer; }
.fleetSelectionRepairRow button:disabled { opacity: 0.45; cursor: default; }
.fleetSelectionRepairRow small { grid-column: 1 / -1; color: rgba(169, 244, 212, 0.7); font-size: 7px; }

.fleetSelectionPrimaryBtn.build {
  color: #8cf2c4;
  border-color: rgba(70, 220, 150, 0.62);
  background: linear-gradient(180deg, rgba(18, 82, 58, 0.72), rgba(8, 38, 30, 0.78));
}

.fleetSelectionPrimaryBtn.active {
  box-shadow: 0 0 18px currentColor;
}

.fleetSelectionPolicyRow {
  grid-template-columns: repeat(3, 30px);
  justify-content: start;
  align-items: center;
}

.fleetSelectionPolicyWrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.fleetSelectionPolicyBtn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  background: rgba(5, 17, 24, 0.76);
}

.fleetSelectionPolicyBtn.chase {
  color: #4ed0ff;
  border-color: rgba(78, 208, 255, 0.56);
}

.fleetSelectionPolicyBtn.stance {
  color: #2df685;
  border-color: rgba(45, 246, 133, 0.54);
}

.fleetSelectionPolicyBtn.behavior {
  color: #ffd43c;
  border-color: rgba(255, 212, 60, 0.56);
}

.fleetSelectionPolicyBtn.active {
  box-shadow: 0 0 14px currentColor, inset 0 0 12px rgba(255, 255, 255, 0.08);
}

.fleetSelectionPolicyMenu {
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: calc(100% + 7px);
  transform: translateX(-50%);
  min-width: 154px;
  display: grid;
  grid-template-columns: repeat(4, 30px);
  gap: 5px;
  padding: 7px;
  border: 1px solid rgba(242, 82, 210, 0.48);
  background: rgba(4, 8, 15, 0.96);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5), 0 0 18px rgba(242, 82, 210, 0.2);
}

.fleetSelectionTopStrip .fleetSelectionPolicyMenu {
  bottom: auto;
  top: calc(100% + 7px);
}

.fleetSelectionPolicyMenuBtn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(130, 160, 190, 0.36);
  background: rgba(14, 22, 34, 0.94);
  color: rgba(216, 230, 245, 0.84);
  cursor: pointer;
}

.fleetSelectionPolicyMenuBtn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fleetSelectionPolicyMenuBtn:hover,
.fleetSelectionPolicyMenuBtn.selected {
  border-color: currentColor;
  box-shadow: 0 0 12px currentColor;
}

.fleetSelectionPolicyMenuBtn.selected {
  background: rgba(255, 255, 255, 0.08);
}

.fleetSelectionHealth {
  min-width: 0;
  border-top: 1px solid rgba(155, 178, 205, 0.18);
  padding-top: 7px;
  padding-right: 3px;
}

.fleetSelectionHealthRows {
  display: grid;
  gap: 5px;
}

.fleetSelectionHealthRow {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}

.fleetSelectionHealthRow span:first-child {
  color: rgba(207, 220, 236, 0.76);
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.fleetSelectionHealthBar {
  height: 4px;
  background: rgba(0, 0, 0, 0.58);
  border-radius: 2px;
  overflow: hidden;
}

.fleetSelectionHealthBar i {
  display: block;
  height: 100%;
  width: var(--bar-width, 0%);
  border-radius: inherit;
}

.fleetSelectionHealthBar.shield i {
  background: linear-gradient(90deg, #318ecb, #5bd8ff);
}

.fleetSelectionHealthBar.armor i {
  background: linear-gradient(90deg, #cc8c34, #ffd26c);
}

.fleetSelectionHealthBar.hull i {
  background: linear-gradient(90deg, #32ab66, #4df296);
}

.fleetSelectionHealthNumbers {
  margin-top: 7px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  color: rgba(202, 218, 236, 0.76);
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.fleetSelectionManifest {
  min-width: 0;
  min-height: 0;
  border-top: 1px solid rgba(155, 178, 205, 0.18);
  padding-top: 7px;
  display: grid;
  grid-template-rows: 13px minmax(0, 1fr);
  gap: 4px;
}

.fleetSelectionManifestTitle {
  color: rgba(229, 238, 249, 0.84);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.fleetSelectionShipList {
  min-height: 0;
  overflow-y: auto;
  border: 1px solid rgba(121, 148, 175, 0.28);
  background: rgba(1, 8, 14, 0.48);
  padding: 5px 6px 5px 5px;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 159, 190, 0.72) rgba(0, 0, 0, 0.28);
}

.fleetSelectionShipList::-webkit-scrollbar {
  width: 7px;
}

.fleetSelectionShipList::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.28);
}

.fleetSelectionShipList::-webkit-scrollbar-thumb {
  background: rgba(128, 159, 190, 0.72);
  border-radius: 6px;
}

.fleetSelectionShipRow {
  min-width: 0;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 40px;
  gap: 7px;
  align-items: center;
  min-height: 48px;
  padding: 5px;
  border: 1px solid rgba(103, 255, 185, 0.18);
  background: linear-gradient(90deg, rgba(16, 38, 31, 0.62), rgba(9, 15, 23, 0.72));
}

.fleetSelectionShipRow + .fleetSelectionShipRow {
  margin-top: 5px;
}

.fleetSelectionShipThumb {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--selection-color);
  filter: drop-shadow(0 0 8px currentColor);
}

.fleetSelectionShipThumb svg {
  width: 31px;
  height: 31px;
  fill: currentColor;
}

.fleetSelectionShipInfo {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.fleetSelectionShipNameLine {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.fleetSelectionShipName {
  min-width: 0;
  color: rgba(235, 246, 255, 0.95);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fleetSelectionDesignTag {
  flex: 0 0 auto;
  max-width: 82px;
  padding: 1px 4px;
  border: 1px solid rgba(242, 82, 210, 0.42);
  color: #ff9df1;
  font-size: 6px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fleetSelectionShipClass {
  color: rgba(197, 211, 229, 0.68);
  font-size: 8px;
  font-weight: 700;
}

.fleetSelectionShipChips {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.fleetSelectionShipChip {
  min-width: 0;
  padding: 1px 3px;
  border: 1px solid rgba(134, 164, 194, 0.2);
  background: rgba(0, 0, 0, 0.24);
  color: rgba(210, 226, 244, 0.78);
  font-size: 6px;
  font-weight: 800;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.fleetSelectionShipIntegrity {
  min-width: 0;
  display: grid;
  gap: 5px;
  justify-items: end;
}

.fleetSelectionShipIntegrity strong {
  color: rgba(231, 255, 242, 0.96);
  font-size: 9px;
  font-weight: 900;
}

.fleetSelectionMiniHealth {
  width: 32px;
  height: 3px;
  background: rgba(0, 0, 0, 0.58);
  overflow: hidden;
  border-radius: 2px;
}

.fleetSelectionMiniHealth i {
  display: block;
  height: 100%;
  width: var(--bar-width, 0%);
  background: linear-gradient(90deg, #32ab66, #4df296);
}

.fleetSelectionEmptyShips {
  padding: 14px 8px;
  color: rgba(198, 213, 230, 0.58);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
}

@media (max-width: 520px) {
  .spaceSelectionPanel.fleet {
    height: auto;
  }

  .fleetSelectionBody {
    height: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .fleetSelectionCommandStack {
    grid-row: auto;
  }
}

    `;
    document.head.appendChild(style);
  }

  public select(data: SelectionData, shiftKey: boolean): void {
    if (!shiftKey) {
      this.selections.clear();
    }
    this.selections.set(this.getSelectionKey(data), data);
    this.render();
  }

  public deselect(type: SelectionType): void {
    for (const key of Array.from(this.selections.keys())) {
      if (key.startsWith(`${type}:`)) {
        this.selections.delete(key);
        if (this.activePolicyPicker?.selectionKey === key) this.activePolicyPicker = null;
      }
    }
    this.render();
  }

  public clear(): void {
    this.selections.clear();
    this.activeShipAction = null;
    this.activePolicyPicker = null;
    this.render();
  }

  public hasSelection(type: SelectionType, id?: string): boolean {
    if (id) return this.selections.has(`${type}:${id}`);
    for (const key of this.selections.keys()) {
      if (key.startsWith(`${type}:`)) return true;
    }
    return false;
  }

  public setActiveShipAction(action: ShipAction | null): void {
    this.activeShipAction = action;
    this.render();
  }

  public setClockYear(year: number): void {
    if (!Number.isFinite(year)) return;
    this.clockYear = year;
    this.updateFleetMovementTimers();
  }

  private render(): void {
    const existingContainer = this.root.querySelector(".spaceSelectionPanelContainer");
    if (existingContainer) {
      existingContainer.remove();
    }

    if (this.selections.size === 0) {
      this.containerElement = null;
      this.activePolicyPicker = null;
      return;
    }

    const container = document.createElement("div");
    container.className = "spaceSelectionPanelContainer";
    this.containerElement = container;

    container.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.canvasElement?.focus({ preventScroll: true });
    });
    container.addEventListener("click", (e) => e.stopPropagation());
    container.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    for (const [, data] of this.selections) {
      const panel = this.createPanelElement(data);
      container.appendChild(panel);
    }

    this.root.appendChild(container);
  }

  private createPanelElement(data: SelectionData): HTMLDivElement {
    if (data.type === "fleet") {
      return this.createFleetPanelElement(data);
    }

    const panel = document.createElement("div");
    panel.className = `spaceSelectionPanel ${data.type}`;
    if (data.ownerColor) {
      panel.style.setProperty("--selection-color", this.colorToCss(data.ownerColor, 0.95));
      panel.style.setProperty("--selection-color-soft", this.colorToCss(data.ownerColor, 0.24));
    }

    const hull = data.hull ?? data.hp;
    const maxHull = Math.max(1, data.maxHull ?? data.maxHp);
    const shield = data.shield ?? 0;
    const maxShield = Math.max(0, data.maxShield ?? 0);
    const armor = data.armor ?? 0;
    const maxArmor = Math.max(0, data.maxArmor ?? 0);
    const hullPercent = Math.round((hull / maxHull) * 100);
    const hullWidth = (hull / maxHull) * 100;
    const shieldWidth = maxShield > 0 ? (shield / maxShield) * 100 : 0;
    const armorWidth = maxArmor > 0 ? (armor / maxArmor) * 100 : 0;
    const showLayers = maxShield > 0 || maxArmor > 0;

    const status = data.status ?? "Operational";
    let classLine = "";
    if (data.class) {
      classLine = `
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Class</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(data.class)}</span>
        </div>
      `;
    }

    const ownerLine = data.ownerName
      ? `
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Owner</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(data.ownerName)}</span>
        </div>
      `
      : "";
    const detailLine = data.detail
      ? `<div class="spaceSelectionPanelDetail">${this.escapeHtml(data.detail)}</div>`
      : "";
    const actionLabels: Record<ShipAction, string> = {
      move: "Move",
      build: "Build",
      colonize: "Colonize",
      attack: "Attack",
      merge: "Merge",
      stop: "Stop",
      toggleDarkMatterBoost: "Dark Matter Boost",
      retreat: "Retreat",
      retreatTo: "Retreat To",
      emergencyRetreatTo: "Emergency Retreat",
      orbit: "Orbit",
      hold: "Hold",
      guard: "Guard",
      protect: "Protect",
    };
    const actions = (data.actions && data.actions.length > 0)
      ? data.actions
      : ["move", "build", "attack", "merge"];
    const actionButtons = data.type === "ship" && data.canCommand
      ? `
        <div class="spaceSelectionActions">
          ${actions.map((action) => `
            <button
              class="spaceSelectionActionBtn ${this.activeShipAction === action ? "active" : ""}"
              type="button"
              data-selection-key="${this.escapeHtml(this.getSelectionKey(data))}"
              data-action="${action}">
              ${actionLabels[action as ShipAction] ?? action}
            </button>
          `).join("")}
        </div>
      `
      : "";

    panel.innerHTML = `
      <div class="spaceSelectionPanelTitle">${this.escapeHtml(data.name)}</div>
      <div class="spaceSelectionPanelContent">
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Status</span>
          <span class="spaceSelectionPanelValue">${this.escapeHtml(status)}</span>
        </div>
        ${ownerLine}
        ${classLine}
        ${detailLine}
        <div class="spaceSelectionPanelRow">
          <span class="spaceSelectionPanelLabel">Integrity</span>
          <span class="spaceSelectionPanelValue">${hullPercent}%</span>
        </div>
        <div class="spaceSelectionPanelLayerStack">
          ${showLayers ? `
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill shield" style="width: ${shieldWidth}%"></div>
          </div>
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill armor" style="width: ${armorWidth}%"></div>
          </div>
          ` : ""}
          <div class="spaceSelectionPanelLayerBar">
            <div class="spaceSelectionPanelLayerFill hull" style="width: ${hullWidth}%"></div>
          </div>
        </div>
        <div class="spaceSelectionPanelHpPercent">
          ${showLayers
            ? `S ${Math.round(shield)} / ${Math.round(maxShield)} | A ${Math.round(armor)} / ${Math.round(maxArmor)} | H ${Math.round(hull)} / ${Math.round(maxHull)}`
            : `${Math.round(hull)} / ${Math.round(maxHull)}`}
        </div>
        ${actionButtons}
      </div>
    `;

    for (const button of panel.querySelectorAll<HTMLButtonElement>(".spaceSelectionActionBtn")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const action = button.dataset.action as ShipAction | undefined;
        if (!action) return;
        const selectionKey = button.dataset.selectionKey;
        const selection = selectionKey ? this.selections.get(selectionKey) : undefined;
        this.callbacks.onShipAction?.(action, selection);
      });
    }

    return panel;
  }

  private createFleetPanelElement(data: SelectionData): HTMLDivElement {
    const panel = document.createElement("div");
    panel.className = "spaceSelectionPanel fleet";
    if (data.ownerColor) {
      panel.style.setProperty("--selection-color", this.colorToCss(data.ownerColor, 0.95));
      panel.style.setProperty("--selection-color-soft", this.colorToCss(data.ownerColor, 0.24));
    }

    const hull = Math.max(0, data.hull ?? data.hp);
    const maxHull = Math.max(1, data.maxHull ?? data.maxHp);
    const shield = Math.max(0, data.shield ?? 0);
    const maxShield = Math.max(0, data.maxShield ?? 0);
    const armor = Math.max(0, data.armor ?? 0);
    const maxArmor = Math.max(0, data.maxArmor ?? 0);
    const integrityPercent = this.percentValue(hull, maxHull);
    const ships = data.ships ?? [];
    const shipCount = data.shipCount ?? Math.max(ships.length, 0);
    const selectionKey = this.getSelectionKey(data);
    const secondaryAction: ShipAction = (data.actions ?? []).includes("build")
      ? "build"
      : (data.actions ?? []).includes("colonize")
        ? "colonize"
        : "attack";
    const secondaryClass = secondaryAction === "build"
      ? "fleetSelectionPrimaryBtn build"
      : secondaryAction === "colonize"
        ? "fleetSelectionPrimaryBtn build"
        : "fleetSelectionPrimaryBtn attack";
    const secondaryLabel = secondaryAction === "build"
      ? "Build structure"
      : secondaryAction === "colonize"
        ? "Colonize planet"
        : "Attack target";
    const secondaryIcon = secondaryAction === "build" || secondaryAction === "colonize" ? "build" : "attack";
    const secondaryText = secondaryAction === "build" ? "BUILD" : secondaryAction === "colonize" ? "COLONIZE" : "ATTACK";
    panel.dataset.selectionKey = selectionKey;

    panel.innerHTML = `
      <div class="fleetSelectionTopStrip">
        ${this.renderFleetActionButton(data, "merge", "fleetSelectionToolBtn", "Merge fleets", "merge")}
        ${this.renderFleetActionButton(data, "stop", "fleetSelectionToolBtn stop", "Stop fleet", "stop")}
        ${this.renderFleetActionButton(data, "retreat", "fleetSelectionToolBtn retreatText", "Retreat fleet", undefined, "RETREAT")}
        ${this.renderFleetActionButton(data, "retreatTo", "fleetSelectionToolBtn", "Set retreat target", "retreatTarget")}
        ${this.renderFleetActionButton(
          data,
          "toggleDarkMatterBoost",
          "fleetSelectionToolBtn darkMatterBoost",
          data.movement?.darkMatterBoostActive
            ? "Disable Dark Matter speed boost"
            : "Activate 10x Dark Matter speed boost",
          "darkMatterBoost",
        )}
        <div class="fleetSelectionTopMeta">ID: ${this.escapeHtml(data.readoutId ?? data.id ?? "--")}</div>
      </div>
      <div class="fleetSelectionBody">
        <section class="fleetSelectionIdentity">
          <div class="fleetSelectionTitle">${this.escapeHtml(data.name)}</div>
          <div class="fleetSelectionIdentityGrid">
            ${this.renderFleetLeaderButton(data)}
            <div class="fleetSelectionMetaRows">
              ${this.renderFleetMetaRow("Status", data.status ?? "Operational")}
              ${data.ownerName ? this.renderFleetMetaRow("Owner", data.ownerName) : ""}
              ${data.class ? this.renderFleetMetaRow("Class", data.class) : ""}
              ${this.renderFleetMetaRow("Integrity", `${integrityPercent}%`)}
            </div>
          </div>
        </section>
        <section class="fleetSelectionCommandStack">
          <div class="fleetSelectionPrimaryRow">
            ${this.renderFleetActionButton(data, "move", "fleetSelectionPrimaryBtn move", "Move fleet", "move", "MOVE")}
            ${this.renderFleetActionButton(data, secondaryAction, secondaryClass, secondaryLabel, secondaryIcon, secondaryText)}
          </div>
          <div class="fleetSelectionCommandLower">
            <div class="fleetSelectionPolicyRow">
              ${this.renderFleetPolicyButton(data, selectionKey, "engagementRule", "fleetSelectionPolicyBtn stance", "Engagement rule")}
              ${this.renderFleetPolicyButton(data, selectionKey, "doctrine", "fleetSelectionPolicyBtn behavior", "Tactical doctrine")}
              ${this.renderFleetPolicyButton(data, selectionKey, "retreatPreset", "fleetSelectionPolicyBtn chase", "Retreat preset")}
            </div>
            ${this.renderFleetMovementDetails(data)}
          </div>
          ${this.renderFleetRepairControl(data)}
        </section>
        <section class="fleetSelectionHealth">
          <div class="fleetSelectionHealthRows">
            ${this.renderFleetHealthRow("Shields", "shield", shield, maxShield)}
            ${this.renderFleetHealthRow("Armor", "armor", armor, maxArmor)}
            ${this.renderFleetHealthRow("Hull", "hull", hull, maxHull)}
          </div>
          <div class="fleetSelectionHealthNumbers">
            <span>S ${Math.round(shield)} / ${Math.round(maxShield)}</span>
            <span>A ${Math.round(armor)} / ${Math.round(maxArmor)}</span>
            <span>H ${Math.round(hull)} / ${Math.round(maxHull)}</span>
          </div>
        </section>
        <section class="fleetSelectionManifest">
          <div class="fleetSelectionManifestTitle">Ships (${ships.length} / ${shipCount})</div>
          <div class="fleetSelectionShipList">
            ${ships.length > 0
              ? ships.map((ship) => this.renderFleetShipRow(ship)).join("")
              : '<div class="fleetSelectionEmptyShips">No ship telemetry</div>'}
          </div>
        </section>
      </div>
    `;

    for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const action = button.dataset.action as ShipAction | undefined;
        if (!action || button.disabled) return;
        this.activePolicyPicker = null;
        this.callbacks.onShipAction?.(action, data);
      });
    }

    for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-policy]")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const control = button.dataset.policy as FleetPolicyControl | undefined;
        if (!control || button.disabled) return;
        this.activePolicyPicker = this.activePolicyPicker?.selectionKey === selectionKey
          && this.activePolicyPicker.control === control
          ? null
          : { selectionKey, control };
        this.render();
      });
    }

    for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-policy-option]")) {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const control = button.dataset.policyControl as FleetPolicyControl | undefined;
        const value = button.dataset.policyOption as FleetPolicyValue | undefined;
        if (!control || !value || button.disabled) return;
        this.activePolicyPicker = null;
        this.callbacks.onFleetPolicyChange?.(control, value, data);
      });
    }

    panel.querySelector<HTMLButtonElement>("[data-field-repair]")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const constructionFleetId = data.id;
      const targetFleetId = panel.querySelector<HTMLSelectElement>("[data-field-repair-target]")?.value;
      if (!constructionFleetId || !targetFleetId) return;
      this.callbacks.onRepairFleet?.(constructionFleetId, targetFleetId);
    });

    panel.querySelector<HTMLButtonElement>("[data-open-fleet-leaders]")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!data.id || data.canCommand !== true) return;
      requestOpenLeadersPanel({
        assignmentTarget: {
          kind: "fleet",
          targetId: data.id,
          label: data.name,
          requiredClass: "military",
        },
      });
    });

    return panel;
  }

  private renderFleetActionButton(
    data: SelectionData,
    action: ShipAction,
    className: string,
    label: string,
    icon?: string,
    visibleLabel?: string,
  ): string {
    const enabled = data.canCommand === true && (data.actions ?? []).includes(action);
    const active = this.activeShipAction === action
      || (action === "toggleDarkMatterBoost" && data.movement?.darkMatterBoostActive)
      ? " active"
      : "";
    const contents = `${icon ? this.renderIcon(icon) : ""}${visibleLabel ? `<span>${this.escapeHtml(visibleLabel)}</span>` : ""}`;
    return `
      <button
        class="${className}${active}"
        type="button"
        ${enabled ? `data-action="${action}"` : "disabled"}
        title="${this.escapeHtml(label)}"
        aria-label="${this.escapeHtml(label)}">
        ${contents}
      </button>
    `;
  }

  private renderFleetPolicyButton(
    data: SelectionData,
    selectionKey: string,
    control: FleetPolicyControl,
    className: string,
    label: string,
  ): string {
    const enabled = data.canCommand === true;
    const value = this.getFleetPolicyValue(data, control);
    const active = value && value !== "none" ? " active" : "";
    const open = this.activePolicyPicker?.selectionKey === selectionKey && this.activePolicyPicker.control === control;
    const title = value
      ? `${label}: ${this.formatPolicyValue(value)}.`
      : label;
    const icon = this.getFleetPolicyOptionIcon(control, value);
    return `
      <span class="fleetSelectionPolicyWrap">
        <button
          class="${className}${active}"
          type="button"
          ${enabled ? `data-policy="${control}" data-selection-key="${this.escapeHtml(selectionKey)}"` : "disabled"}
          title="${this.escapeHtml(title)}"
          aria-label="${this.escapeHtml(title)}"
          aria-expanded="${open ? "true" : "false"}">
          ${this.renderIcon(icon)}
        </button>
        ${open ? this.renderFleetPolicyMenu(control, value) : ""}
      </span>
    `;
  }

  private renderFleetRepairControl(data: SelectionData): string {
    if (!data.repairTargets) return "";
    const targets = data.repairTargets;
    return `
      <div class="fleetSelectionRepairRow">
        <select data-field-repair-target aria-label="Field repair target" ${targets.length > 0 ? "" : "disabled"}>
          ${targets.length > 0
            ? targets.map((target) => `<option value="${this.escapeHtml(target.fleetId)}" ${data.activeRepairTargetFleetId === target.fleetId ? "selected" : ""}>${this.escapeHtml(target.label)}</option>`).join("")
            : '<option value="">No damaged fleet in system</option>'}
        </select>
        <button type="button" data-field-repair ${data.canCommand && targets.length > 0 ? "" : "disabled"}>${data.activeRepairTargetFleetId ? "Retarget Repair" : "Field Repair"}</button>
        ${data.repairStatus ? `<small>${this.escapeHtml(data.repairStatus)}</small>` : ""}
      </div>
    `;
  }

  private renderFleetPolicyMenu(control: FleetPolicyControl, currentValue: string | undefined): string {
    const options = this.getFleetPolicyOptions(control);
    return `
      <div class="fleetSelectionPolicyMenu" role="menu">
        ${options.map((option) => `
          <button
            class="fleetSelectionPolicyMenuBtn ${option.value === currentValue ? "selected" : ""}"
            type="button"
            data-policy-control="${control}"
            data-policy-option="${option.value}"
            title="${this.escapeHtml(option.label)}"
            aria-label="${this.escapeHtml(option.label)}"
            style="color: ${option.color}">
            ${this.renderIcon(option.icon)}
          </button>
        `).join("")}
      </div>
    `;
  }

  private renderFleetLeaderButton(data: SelectionData): string {
    const leader = data.leader ?? null;
    const assignable = data.canCommand === true && Boolean(data.id);
    const leaderName = leader?.name ?? "Add leader";
    const leaderLabel = leader ? `Commander | Level ${leader.level}` : "No commander assigned";
    const initials = leader
      ? leader.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
      : "";
    const portrait = leader?.portraitUrl
      ? `<img src="${this.escapeHtml(leader.portraitUrl)}" alt="" />`
      : leader
        ? `<span>${this.escapeHtml(initials)}</span>`
        : "<i>+</i>";
    return `
      <button
        class="fleetSelectionLeaderCard ${assignable ? "assignable" : ""}"
        type="button"
        ${assignable ? "data-open-fleet-leaders" : "disabled"}
        title="Add fleet leader"
        aria-label="Add fleet leader">
        <div class="fleetSelectionLeaderPortrait${leader?.portraitUrl ? " hasPortrait" : ""}" aria-hidden="true">
          ${portrait}
        </div>
        <div class="fleetSelectionLeaderText">
          <strong>${this.escapeHtml(leaderName)}</strong>
          <span>${this.escapeHtml(leaderLabel)}</span>
        </div>
      </button>
    `;
  }

  private renderFleetMovementDetails(data: SelectionData): string {
    if (!data.movement) return "";
    const progress = this.getFleetMovementProgress(data.movement.startedYear, data.movement.arrivalYear);
    return `
      <div class="fleetSelectionMovement">
        <div class="fleetSelectionMovementRow destination">
          <span>Destination</span>
          <strong>${this.escapeHtml(data.movement.destination)}</strong>
        </div>
        <div class="fleetSelectionMovementRow">
          <span>Arrival</span>
          <strong title="${this.escapeHtml(this.formatFleetArrival(data.movement.arrivalYear))}">${this.escapeHtml(this.formatFleetArrivalDate(data.movement.arrivalYear))}</strong>
        </div>
        <div class="fleetSelectionMovementRow">
          <span>Left</span>
          <strong data-fleet-movement-days-left data-arrival-year="${data.movement.arrivalYear}" data-started-year="${data.movement.startedYear}">
            ${this.escapeHtml(this.formatFleetDaysLeft(data.movement.arrivalYear))}
          </strong>
        </div>
        <div class="fleetSelectionMovementProgress">
          <i data-fleet-movement-progress style="--movement-progress:${progress}%"></i>
        </div>
      </div>
    `;
  }

  private renderFleetMetaRow(label: string, value: string): string {
    return `
      <div class="fleetSelectionMetaRow">
        <span>${this.escapeHtml(label)}</span>
        <span>${this.escapeHtml(value)}</span>
      </div>
    `;
  }

  private renderFleetHealthRow(label: string, kind: "shield" | "armor" | "hull", value: number, maxValue: number): string {
    return `
      <div class="fleetSelectionHealthRow">
        <span>${this.escapeHtml(label)}</span>
        <div class="fleetSelectionHealthBar ${kind}">
          <i style="--bar-width: ${this.percentValue(value, maxValue)}%"></i>
        </div>
      </div>
    `;
  }

  private renderFleetShipRow(ship: SelectionShipData): string {
    const hullPercent = this.percentValue(ship.hull, Math.max(1, ship.maxHull));
    return `
      <article class="fleetSelectionShipRow" style="--selection-color: ${this.colorToCss(ship.ownerColor ?? [0.35, 1, 0.62], 0.95)}">
        <div class="fleetSelectionShipThumb" aria-hidden="true">${this.renderShipSilhouette("compact")}</div>
        <div class="fleetSelectionShipInfo">
          <div class="fleetSelectionShipNameLine">
            <div class="fleetSelectionShipName">${this.escapeHtml(ship.name)}</div>
            <div class="fleetSelectionDesignTag">${this.escapeHtml(ship.designName)}</div>
          </div>
          <div class="fleetSelectionShipClass">${this.escapeHtml(ship.className)}</div>
          <div class="fleetSelectionShipChips">
            <span class="fleetSelectionShipChip">S ${Math.round(ship.shield)}/${Math.round(ship.maxShield)}</span>
            <span class="fleetSelectionShipChip">A ${Math.round(ship.armor)}/${Math.round(ship.maxArmor)}</span>
            <span class="fleetSelectionShipChip">H ${Math.round(ship.hull)}/${Math.round(ship.maxHull)}</span>
          </div>
        </div>
        <div class="fleetSelectionShipIntegrity">
          <strong>${hullPercent}%</strong>
          <div class="fleetSelectionMiniHealth"><i style="--bar-width: ${hullPercent}%"></i></div>
        </div>
      </article>
    `;
  }

  private getFleetPolicyOptions(control: FleetPolicyControl): Array<{
    value: FleetPolicyValue;
    label: string;
    icon: string;
    color: string;
  }> {
    switch (control) {
      case "engagementRule":
        return [
          { value: "avoid", label: "Avoid", icon: "stanceEvade", color: "#62d7ff" },
          { value: "defendSystem", label: "Defend System", icon: "stanceDefend", color: "#50e68a" },
          { value: "engageSystem", label: "Engage System", icon: "stanceAggressive", color: "#ff707a" },
        ];
      case "doctrine":
        return [
          { value: "artillery", label: "Artillery", icon: "behaviorArtillery", color: "#ffd166" },
          { value: "line", label: "Line", icon: "behaviorLine", color: "#d8e6f5" },
          { value: "assault", label: "Assault", icon: "behaviorBrawler", color: "#ff7f6e" },
          { value: "escort", label: "Escort", icon: "behaviorDefender", color: "#60ef98" },
        ];
      case "retreatPreset":
      default:
        return [
          { value: "fightOn", label: "Fight On", icon: "retreatNone", color: "#8fa0ad" },
          { value: "balanced", label: "Balanced", icon: "retreatLow", color: "#58e394" },
          { value: "preserveFleet", label: "Preserve Fleet", icon: "retreatMedium", color: "#ffd35a" },
          { value: "avoidLosses", label: "Avoid Losses", icon: "retreatHigh", color: "#ff6d78" },
        ];
    }
  }

  private getFleetPolicyOptionIcon(control: FleetPolicyControl, value: string | undefined): string {
    const options = this.getFleetPolicyOptions(control);
    return options.find((option) => option.value === value)?.icon ?? options[0]?.icon ?? "sliders";
  }

  private getFleetPolicyValue(data: SelectionData, control: FleetPolicyControl): string | undefined {
    switch (control) {
      case "engagementRule": return data.engagementRule;
      case "doctrine": return data.doctrine;
      case "retreatPreset": return data.retreatPreset;
      default:
        return undefined;
    }
  }

  private formatPolicyValue(value: string): string {
    return value
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (char) => char.toUpperCase());
  }

  private formatFleetArrival(arrivalYear: number): string {
    const date = gameYearToDateTime(arrivalYear);
    return `${date.year} / ${String(date.month).padStart(2, "0")} / ${String(date.day).padStart(2, "0")} ${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}`;
  }

  private formatFleetArrivalDate(arrivalYear: number): string {
    const date = gameYearToDateTime(arrivalYear);
    return `${date.year}/${String(date.month).padStart(2, "0")}/${String(date.day).padStart(2, "0")}`;
  }

  private formatFleetDaysLeft(arrivalYear: number): string {
    const days = Math.max(0, (arrivalYear - this.clockYear) * GAME_DAYS_PER_YEAR);
    if (days >= 10) return `${Math.ceil(days)} days`;
    return `${days.toFixed(1)} days`;
  }

  private getFleetMovementProgress(startedYear: number, arrivalYear: number): number {
    const duration = Math.max(0.000001, arrivalYear - startedYear);
    return Math.max(0, Math.min(100, ((this.clockYear - startedYear) / duration) * 100));
  }

  private updateFleetMovementTimers(): void {
    if (!this.containerElement) return;
    this.containerElement.querySelectorAll<HTMLElement>("[data-fleet-movement-days-left]").forEach((element) => {
      const arrivalYear = Number(element.dataset.arrivalYear);
      if (!Number.isFinite(arrivalYear)) return;
      element.textContent = this.formatFleetDaysLeft(arrivalYear);
      const startedYear = Number(element.dataset.startedYear);
      const fill = element.closest(".fleetSelectionMovement")
        ?.querySelector<HTMLElement>("[data-fleet-movement-progress]");
      if (fill && Number.isFinite(startedYear)) {
        fill.style.setProperty("--movement-progress", `${this.getFleetMovementProgress(startedYear, arrivalYear)}%`);
      }
    });
  }

  private percentValue(value: number, maxValue: number): number {
    if (maxValue <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((value / maxValue) * 100)));
  }

  private renderIcon(name: string): string {
    const icons: Record<string, string> = {
      merge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h5c3 0 4 2 6 5 2 3 3 5 6 5"/><path d="M4 17h5c2.5 0 4-1.8 5.5-4"/><path d="M18 14l3 3-3 3"/><path d="M18 4l3 3-3 3"/></svg>',
      stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
      retreatTarget: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
      retreatCondition: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v4"/><path d="M6 18h12"/><path d="M8 18V9h8v9"/><path d="M5 9h14"/><path d="M8 5h8"/></svg>',
      sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
      move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l6 6-6 6"/><path d="M11 6l6 6-6 6"/><path d="M18 6l2 6-2 6"/></svg>',
      darkMatterBoost: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6 6-6 6"/><path d="M9 6l6 6-6 6"/><path d="M15 6l6 6-6 6"/><circle cx="12" cy="12" r="10" opacity=".22"/></svg>',
      attack: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
      build: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16"/><path d="M6 20V10l6-4 6 4v10"/><path d="M9 20v-6h6v6"/><path d="M12 3v5"/><path d="M9.5 5.5h5"/></svg>',
      chase: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M17 7l3-3"/><path d="M17.5 3.5H20V6"/></svg>',
      shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-5"/></svg>',
      behavior: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7.5l3 7M16 7.5l-3 7M8 6h8"/></svg>',
      stancePassive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/><path d="M9 9l-3 3 3 3"/><path d="M15 9l3 3-3 3"/></svg>',
      stanceEvade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16c5 3 10 1 14-6"/><path d="M14 9h5v5"/><path d="M7 7l3 3-3 3"/></svg>',
      stanceHold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16"/><path d="M7 8h10"/><path d="M7 16h10"/></svg>',
      stanceGuard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7l7-4z"/><path d="M12 8v5"/><path d="M9.5 10.5h5"/></svg>',
      stanceDefend: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      stanceAggressive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h11"/><path d="M12 6l6 6-6 6"/><path d="M5 6l4 3"/><path d="M5 18l4-3"/></svg>',
      stanceHunt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12c3-5 10-7 16-3"/><path d="M16 5l4 4-4 4"/><circle cx="9" cy="13" r="2"/></svg>',
      behaviorArtillery: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17l6-10 8-2-2 8-10 6z"/><path d="M13 7l4 4"/><path d="M4 20l4-4"/></svg>',
      behaviorLine: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/></svg>',
      behaviorBrawler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 16l5-9 5 9"/><path d="M8 13h8"/><path d="M5 19h14"/></svg>',
      behaviorSwarm: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="8" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="12" cy="16" r="2"/><path d="M9 9l2 5"/><path d="M15 9l-2 5"/></svg>',
      behaviorDefender: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v4c0 5-3 8-7 10-4-2-7-5-7-10V7l7-4z"/><path d="M8 14h8"/></svg>',
      chaseNone: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M7 7l10 10"/></svg>',
      chaseSystem: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M16 8l4-4"/></svg>',
      chaseFriendly: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10"/><circle cx="9" cy="16" r="2"/><circle cx="19" cy="6" r="2"/></svg>',
      chaseNeutral: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>',
      chaseEnemy: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 5v14"/><path d="M5 12h14"/><path d="M16 8l4-4"/></svg>',
      retreatNone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
      retreatLow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h12"/><path d="M12 7v7"/><path d="M9 11l3 3 3-3"/></svg>',
      retreatMedium: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/><path d="M12 5v7"/><path d="M9 9l3 3 3-3"/><path d="M6 18h12"/></svg>',
      retreatHigh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12"/><path d="M12 7v10"/><path d="M9 14l3 3 3-3"/></svg>',
    };
    return icons[name] ?? "";
  }

  private renderShipSilhouette(mode: "wide" | "compact" = "wide"): string {
    const viewBox = mode === "compact" ? "0 0 64 64" : "0 0 148 60";
    const body = mode === "compact"
      ? '<path d="M32 5l15 44-15-9-15 9L32 5z" opacity=".9"/><path d="M32 14l7 23-7-4-7 4 7-23z" opacity=".45"/><path d="M21 47l11-7 11 7-11 8-11-8z" opacity=".62"/>'
      : '<path d="M6 36l45-19 49 8 42 20-56-6-30 7L6 36z" opacity=".35"/><path d="M39 30l35-17 32 13-29 11-38-7z" opacity=".75"/><path d="M42 31l42 8 34-5-37 15-39-18z" opacity=".48"/><path d="M63 27l23-8 29 13-37 4-15-9z" opacity=".88"/>';
    return `<svg viewBox="${viewBox}" aria-hidden="true">${body}</svg>`;
  }

  private getSelectionKey(data: SelectionData): string {
    return `${data.type}:${data.id ?? data.type}`;
  }

  private colorToCss(color: [number, number, number], alpha: number): string {
    const r = Math.round(Math.max(0, Math.min(1, color[0])) * 255);
    const g = Math.round(Math.max(0, Math.min(1, color[1])) * 255);
    const b = Math.round(Math.max(0, Math.min(1, color[2])) * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
