import type { TierInfo, TierName } from "../types";

interface TierSelectorProps {
  tiers: TierInfo[];
  selectedTier: TierName;
  disabled: boolean;
  onChange: (tier: TierName) => void;
}

export function TierSelector({
  tiers,
  selectedTier,
  disabled,
  onChange,
}: TierSelectorProps) {
  return (
    <section className="tier-panel" aria-labelledby="tier-heading">
      <div>
        <p className="eyebrow">Model tier</p>
        <h2 id="tier-heading">Choose the trade-off</h2>
      </div>
      <div className="tier-options" role="radiogroup" aria-label="Model tier">
        {tiers.map((tier) => (
          <label
            className={
              tier.name === selectedTier ? "tier-option active" : "tier-option"
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
    </section>
  );
}
