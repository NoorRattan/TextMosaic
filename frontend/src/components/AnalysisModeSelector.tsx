import type { AnalysisMode } from "../types";

interface AnalysisModeSelectorProps {
  mode: AnalysisMode;
  disabled: boolean;
  onChange: (mode: AnalysisMode) => void;
}

const options: Array<{ mode: AnalysisMode; title: string; detail: string }> = [
  {
    mode: "document",
    title: "Document model",
    detail:
      "Fully local language model for broad text maps, with parser-grounded evidence.",
  },
  {
    mode: "extractor",
    title: "Relation model",
    detail:
      "Self-trained entity and relation model for the focused news-style domain.",
  },
];

export function AnalysisModeSelector({
  mode,
  disabled,
  onChange,
}: AnalysisModeSelectorProps) {
  return (
    <section className="mode-panel" aria-labelledby="mode-heading">
      <p className="eyebrow">Reading mode</p>
      <h2 id="mode-heading">Choose the level of interpretation</h2>
      <div className="mode-options" role="radiogroup" aria-label="Reading mode">
        {options.map((option) => (
          <label
            className={
              option.mode === mode ? "mode-option active" : "mode-option"
            }
            key={option.mode}
          >
            <input
              type="radio"
              name="analysis-mode"
              value={option.mode}
              checked={option.mode === mode}
              disabled={disabled}
              onChange={() => onChange(option.mode)}
            />
            <span>{option.title}</span>
            <small>{option.detail}</small>
          </label>
        ))}
      </div>
    </section>
  );
}
