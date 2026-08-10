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
        <span className="character-count">{value.length} / 2,000</span>
      </div>
      <textarea
        aria-label="Text to extract"
        value={value}
        maxLength={2_000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Paste a short news sentence, biography, or company update…"
      />
      <div className="input-footer">
        <p>
          The graph appears only after the self-trained model processes your
          text.
        </p>
        <button
          type="button"
          disabled={isLoading || !canExtract || !value.trim()}
          onClick={onSubmit}
        >
          {isLoading
            ? "Extracting…"
            : canExtract
              ? "Build knowledge graph"
              : "Model service unavailable"}
        </button>
      </div>
    </section>
  );
}
