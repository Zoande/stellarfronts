import { useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  FLAG_COLORS,
  FLAG_CONTAINERS,
  FLAG_PATTERNS,
  FLAG_SYMBOLS,
} from '@/flags/flagGenerator';
import { FLAG_PRESETS } from '@/flags/flagPresets';
import { renderFlagSvg } from '@/flags/renderFlagSvg';
import type { FlagDesign } from '@/flags/flagTypes';
import {
  SPECIES_ARCHETYPES,
  SPECIES_TRAITS,
  SPECIES_TRAIT_MAX_COUNT,
  SPECIES_TRAIT_POINT_BUDGET,
  validateSpeciesTraits,
} from '@/data/Species';
import type { SpeciesArchetypeId, SpeciesSetup, SpeciesTraitId } from '@/data/Species';
import '../styles/FlagJoin.css';

interface FlagJoinFormProps {
  gameName: string;
  busy?: boolean;
  error?: string;
  className?: string;
  cancelLabel?: string;
  submitLabel?: string;
  busyLabel?: string;
  onCancel: () => void;
  onSubmit: (countryName: string, flagDesign: FlagDesign, speciesSetup: SpeciesSetup) => void | Promise<void>;
}

type JoinStep = 'name' | 'species' | 'preset' | 'creator';

interface CustomFlagOptions {
  containerId: string;
  backgroundColorId: string;
  accentColorId: string;
  patternId: string;
  primarySymbolId: string;
  secondarySymbolId: string;
}

function fallback<T>(items: T[], index = 0): T {
  const item = items[index];
  if (!item) throw new Error('Flag catalog is empty');
  return item;
}

function designToOptions(design: FlagDesign): CustomFlagOptions {
  return {
    containerId: design.container.id,
    backgroundColorId: design.backgroundColor.id,
    accentColorId: design.accentColor.id,
    patternId: design.pattern.id,
    primarySymbolId: design.primarySymbol.id,
    secondarySymbolId: design.secondarySymbol?.id ?? '',
  };
}

function buildCustomDesign(options: CustomFlagOptions): FlagDesign {
  const container = FLAG_CONTAINERS.find((item) => item.id === options.containerId) ?? fallback(FLAG_CONTAINERS);
  const backgroundColor = FLAG_COLORS.find((item) => item.id === options.backgroundColorId) ?? fallback(FLAG_COLORS);
  const accentColor = FLAG_COLORS.find((item) => item.id === options.accentColorId) ?? fallback(FLAG_COLORS, 3);
  const pattern = FLAG_PATTERNS.find((item) => item.id === options.patternId) ?? fallback(FLAG_PATTERNS);
  const primarySymbol = FLAG_SYMBOLS.find((item) => item.id === options.primarySymbolId) ?? fallback(FLAG_SYMBOLS);
  const secondarySymbol = options.secondarySymbolId
    ? FLAG_SYMBOLS.find((item) => item.id === options.secondarySymbolId)
    : undefined;

  return {
    container,
    backgroundColor,
    accentColor,
    pattern,
    primarySymbol,
    secondarySymbol,
  };
}

function FlagPreview({ design, size = 92, className = '', title }: {
  design: FlagDesign;
  size?: number;
  className?: string;
  title?: string;
}) {
  const svg = useMemo(() => renderFlagSvg(design, {
    size,
    className: 'flag-join__svg',
    title,
    idPrefix: 'join-flag',
  }), [design, size, title]);

  return (
    <span
      className={`flag-join__preview ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function FlagJoinForm({
  gameName,
  busy = false,
  error = '',
  className = '',
  cancelLabel = 'Cancel',
  submitLabel = 'Continue',
  busyLabel = 'Joining',
  onCancel,
  onSubmit,
}: FlagJoinFormProps) {
  const firstPreset = fallback(FLAG_PRESETS);
  const [step, setStep] = useState<JoinStep>('name');
  const [countryName, setCountryName] = useState('');
  const [attemptedName, setAttemptedName] = useState(false);
  const [speciesName, setSpeciesName] = useState('');
  const [attemptedSpecies, setAttemptedSpecies] = useState(false);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<SpeciesArchetypeId>('humanoid');
  const [selectedTraitIds, setSelectedTraitIds] = useState<SpeciesTraitId[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState(firstPreset.id);
  const [customOptions, setCustomOptions] = useState<CustomFlagOptions>(() => designToOptions(firstPreset.design));

  const selectedPreset = FLAG_PRESETS.find((preset) => preset.id === selectedPresetId) ?? firstPreset;
  const customDesign = useMemo(() => buildCustomDesign(customOptions), [customOptions]);
  const activeDesign = step === 'creator' ? customDesign : selectedPreset.design;
  const nameIsValid = countryName.trim().length > 0;
  const nameError = attemptedName && !nameIsValid ? 'Empire name is required' : '';
  const normalizedSpeciesName = speciesName.trim() || `${countryName.trim() || 'Empire'} Founders`;
  const speciesValidation = validateSpeciesTraits(selectedTraitIds);
  const speciesIsValid = normalizedSpeciesName.length > 0 && speciesValidation.valid;
  const speciesErrors = attemptedSpecies && !speciesIsValid
    ? (speciesValidation.errors.length > 0 ? speciesValidation.errors : ['Species name is required'])
    : [];

  const updateCustomOption = (key: keyof CustomFlagOptions, value: string) => {
    setCustomOptions((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const continueFromName = () => {
    setAttemptedName(true);
    if (!nameIsValid) return;
    setStep('species');
  };

  const continueFromSpecies = () => {
    setAttemptedSpecies(true);
    if (!speciesIsValid) return;
    setStep('preset');
  };

  const submitDesign = () => {
    if (!nameIsValid || busy) return;
    if (!speciesIsValid) {
      setAttemptedSpecies(true);
      return;
    }
    void onSubmit(countryName.trim(), activeDesign, {
      speciesName: normalizedSpeciesName,
      archetypeId: selectedArchetypeId,
      traitIds: selectedTraitIds,
    });
  };

  const toggleTrait = (traitId: SpeciesTraitId) => {
    setSelectedTraitIds((current) => (
      current.includes(traitId)
        ? current.filter((id) => id !== traitId)
        : [...current, traitId]
    ));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 'name') {
      continueFromName();
      return;
    }
    if (step === 'species') {
      continueFromSpecies();
      return;
    }
    submitDesign();
  };

  const rootClass = [
    className,
    'flag-join',
    step === 'name' ? 'flag-join--name' : 'flag-join--flag',
  ].filter(Boolean).join(' ');

  return (
    <form className={rootClass} onSubmit={handleSubmit}>
      <div className="flag-join__header">
        <div className="flag-join__kicker">
          {step === 'name' ? 'Join Game' : step === 'species' ? 'Founding Species' : 'Empire Flag'}
        </div>
        <h2>{step === 'name' ? `Join ${gameName}` : step === 'species' ? countryName.trim() : countryName.trim()}</h2>
        <p>{step === 'name' ? 'Name the empire you will command.' : step === 'species' ? gameName : normalizedSpeciesName}</p>
      </div>

      {step === 'name' ? (
        <div className="flag-join__name-step">
          <label htmlFor="flag-join-country-name">Empire name</label>
          <input
            id="flag-join-country-name"
            value={countryName}
            maxLength={48}
            autoFocus
            onChange={(event) => setCountryName(event.target.value)}
          />
          {nameError && <div className="flag-join__error">{nameError}</div>}
        </div>
      ) : step === 'species' ? (
        <div className="flag-join__species-step">
          <label className="flag-join__select">
            Species name
            <input
              value={speciesName}
              maxLength={48}
              placeholder={`${countryName.trim() || 'Empire'} Founders`}
              onChange={(event) => setSpeciesName(event.target.value)}
            />
          </label>

          <div className="flag-join__species-section">
            <div className="flag-join__species-heading">Archetype</div>
            <div className="flag-join__archetype-grid">
              {SPECIES_ARCHETYPES.map((archetype) => (
                <button
                  key={archetype.id}
                  type="button"
                  className={`flag-join__archetype ${selectedArchetypeId === archetype.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedArchetypeId(archetype.id)}
                >
                  <span>{archetype.icon}</span>
                  <strong>{archetype.name}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="flag-join__species-section">
            <div className="flag-join__trait-meter">
              <span>{selectedTraitIds.length}/{SPECIES_TRAIT_MAX_COUNT} traits</span>
              <span>{speciesValidation.remainingPoints}/{SPECIES_TRAIT_POINT_BUDGET} points</span>
            </div>
            <div className="flag-join__trait-grid">
              {SPECIES_TRAITS.map((trait) => {
                const selected = selectedTraitIds.includes(trait.id);
                const nextSelection = selected
                  ? selectedTraitIds.filter((id) => id !== trait.id)
                  : [...selectedTraitIds, trait.id];
                const canSelect = selected || validateSpeciesTraits(nextSelection).valid;
                return (
                  <button
                    key={trait.id}
                    type="button"
                    className={`flag-join__trait flag-join__trait--${trait.polarity} ${selected ? 'is-selected' : ''}`}
                    disabled={!canSelect}
                    onClick={() => toggleTrait(trait.id)}
                  >
                    <span className="flag-join__trait-cost">{trait.pointCost > 0 ? `-${trait.pointCost}` : `+${Math.abs(trait.pointCost)}`}</span>
                    <strong>{trait.name}</strong>
                    <small>{trait.description}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {speciesErrors.map((message) => (
            <div key={message} className="flag-join__error">{message}</div>
          ))}
        </div>
      ) : (
        <div className={`flag-join__flag-step ${step === 'creator' ? 'is-creator' : ''}`}>
          <div className="flag-join__summary">
            <FlagPreview design={activeDesign} size={156} className="flag-join__preview--large" title="Selected flag" />
            <div>
              <div className="flag-join__summary-label">{step === 'creator' ? 'Custom flag' : selectedPreset.name}</div>
              <div className="flag-join__summary-meta">
                {activeDesign.container.label} / {activeDesign.pattern.label} / {activeDesign.primarySymbol.label}
              </div>
            </div>
          </div>

          {step === 'preset' ? (
            <>
              <div className="flag-join__preset-grid" aria-label="Flag presets">
                {FLAG_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`flag-join__preset ${preset.id === selectedPreset.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedPresetId(preset.id)}
                  >
                    <FlagPreview design={preset.design} size={62} title={preset.name} />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="flag-join__custom-btn"
                onClick={() => {
                  setCustomOptions(designToOptions(selectedPreset.design));
                  setStep('creator');
                }}
              >
                Make Your Own
              </button>
            </>
          ) : (
            <div className="flag-join__creator">
              <fieldset className="flag-join__field">
                <legend>Field color</legend>
                <div className="flag-join__swatches">
                  {FLAG_COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      className={`flag-join__swatch ${customOptions.backgroundColorId === color.id ? 'is-selected' : ''}`}
                      style={{ '--flag-swatch': color.hex } as CSSProperties}
                      aria-label={color.label}
                      title={color.label}
                      onClick={() => updateCustomOption('backgroundColorId', color.id)}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="flag-join__field">
                <legend>Accent color</legend>
                <div className="flag-join__swatches">
                  {FLAG_COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      className={`flag-join__swatch ${customOptions.accentColorId === color.id ? 'is-selected' : ''}`}
                      style={{ '--flag-swatch': color.hex } as CSSProperties}
                      aria-label={color.label}
                      title={color.label}
                      onClick={() => updateCustomOption('accentColorId', color.id)}
                    />
                  ))}
                </div>
              </fieldset>

              <label className="flag-join__select">
                Shape
                <select value={customOptions.containerId} onChange={(event) => updateCustomOption('containerId', event.target.value)}>
                  {FLAG_CONTAINERS.map((container) => (
                    <option key={container.id} value={container.id}>{container.label}</option>
                  ))}
                </select>
              </label>

              <label className="flag-join__select">
                Pattern
                <select value={customOptions.patternId} onChange={(event) => updateCustomOption('patternId', event.target.value)}>
                  {FLAG_PATTERNS.map((pattern) => (
                    <option key={pattern.id} value={pattern.id}>{pattern.label}</option>
                  ))}
                </select>
              </label>

              <label className="flag-join__select">
                Primary symbol
                <select value={customOptions.primarySymbolId} onChange={(event) => updateCustomOption('primarySymbolId', event.target.value)}>
                  {FLAG_SYMBOLS.map((symbol) => (
                    <option key={symbol.id} value={symbol.id}>{symbol.label}</option>
                  ))}
                </select>
              </label>

              <label className="flag-join__select">
                Secondary symbol
                <select value={customOptions.secondarySymbolId} onChange={(event) => updateCustomOption('secondarySymbolId', event.target.value)}>
                  <option value="">None</option>
                  {FLAG_SYMBOLS.map((symbol) => (
                    <option key={symbol.id} value={symbol.id}>{symbol.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {error && <div className="flag-join__error">{error}</div>}

      <div className="flag-join__actions">
        <button
          type="button"
          className="flag-join__secondary"
          onClick={step === 'creator' ? () => setStep('preset') : step === 'species' ? () => setStep('name') : onCancel}
          disabled={busy}
        >
          {step === 'creator' || step === 'species' ? 'Back' : cancelLabel}
        </button>
          {step === 'preset' && (
          <button
            type="button"
            className="flag-join__secondary"
            onClick={() => setStep('species')}
            disabled={busy}
          >
            Back
          </button>
        )}
        <button type="submit" className="flag-join__primary" disabled={busy}>
          {busy ? busyLabel : step === 'name' ? 'Species' : step === 'species' ? 'Choose Flag' : submitLabel}
        </button>
      </div>
    </form>
  );
}
