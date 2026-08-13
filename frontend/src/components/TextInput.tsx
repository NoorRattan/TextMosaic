interface TextInputProps {
  value: string;
  isLoading: boolean;
  canExtract: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function TextInput({
  value,
  isLoading,
  canExtract,
  onChange,
  onSubmit,
}: TextInputProps) {
  return (
    <section className="input-panel" aria-labelledby="input-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Source text</p>
          <h2 id="input-heading">Compose a graph from real text</h2>
        </div>
        <span className="character-count">
          {value.length.toLocaleString()} / 12,000
        </span>
      </div>
      <textarea
        aria-label="Text to extract"
        value={value}
        maxLength={12_000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Paste a research abstract, policy clause, report, or dense passage"
      />
      <div className="input-footer">
        <p>
          Each map keeps its source evidence visible. The bundled model reads
          your text inside this browser; no server or model API is used.
        </p>
        <button
          type="button"
          disabled={isLoading || !canExtract || !value.trim()}
          onClick={onSubmit}
        >
          {isLoading
            ? "Running local model..."
            : canExtract
              ? "Build knowledge graph"
              : "Model service unavailable"}
        </button>
      </div>
    </section>
  );
}
