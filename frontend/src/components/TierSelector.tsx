import type { TierInfo, TierName } from "../types";

interface TierSelectorProps {
  tiers: TierInfo[];
  selectedTier: TierName;
  disabled: boolean;
  isLoading: boolean;
  error: string | null;
  onChange: (tier: TierName) => void;
  onRetry: () => void;
}

export function TierSelector({
  tiers,
  selectedTier,
  disabled,
  isLoading,
  error,
  onChange,
  onRetry,
}: TierSelectorProps) {
  return (
    <section className="tier-panel" aria-labelledby="tier-heading">
      <div>
        <p className="eyebrow">Model tier</p>
        <h2 id="tier-heading">Choose the trade-off</h2>
      </div>
      {tiers.length > 0 ? (
        <div className="tier-options" role="radiogroup" aria-label="Model tier">
          {tiers.map((tier) => (
            <label
              className={
                tier.name === selectedTier
                  ? "tier-option active"
                  : "tier-option"
              }
              key={tier.name}
            >
              <input
                type="radio"
                name="tier"
                value={tier.name}
                checked={tier.name === selectedTier}
                disabled={disabled}
                onChange={() => onChange(tier.name)}
              />
              <span>{tier.name}</span>
              <small>{tier.description}</small>
            </label>
          ))}
        </div>
      ) : (
        <div className="tier-status" aria-live="polite">
          <p>
            {isLoading
              ? "Loading model options…"
              : "Model options are unavailable."}
          </p>
          {error ? <small>{error}</small> : null}
          {!isLoading ? (
            <button type="button" className="retry-button" onClick={onRetry}>
              Retry model connection
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
