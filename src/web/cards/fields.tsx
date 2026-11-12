import { CARD_FIELDS, type CardFields, type FieldSpec } from "../../shared/cards";
import { PhotoField } from "./PhotoField";
import flatbedMaterials from "../../../data/catalogs/flatbed-materials.json";
import rollMaterials from "../../../data/catalogs/roll-print-materials.json";

const MATERIALS = [...rollMaterials.items]
  .sort((a, b) => Number(b.favorite) - Number(a.favorite))
  .map((m) => m.name);
const FLATBED_MATERIALS = flatbedMaterials.items.map((m) => m.name);

/** Suggestions for a role's Material field: flatbed boards for Print FB, the roll list otherwise. */
const materialsFor = (roleId: string) => (roleId === "printer_fb" ? FLATBED_MATERIALS : roleId === "liquid_lam" ? [] : MATERIALS);

type Props = {
  roleId: string;
  values: CardFields;
  onChange: (key: string, value: string | boolean | null) => void;
  disabled?: boolean;
  /** Shown as the placeholder when the field is empty (e.g. the docket address). */
  placeholders?: Record<string, string>;
  /** Needed by the Photos field (uploads belong to a card). */
  cardId?: number;
};

const required = (s: FieldSpec) => (s.required ? <span className="text-accent" aria-hidden="true"> ★</span> : null);

/** The editors for one role's card fields, in the spec's order. */
export function CardFieldsEditor({ roleId, values, onChange, disabled, placeholders = {}, cardId }: Props) {
  const specs = CARD_FIELDS[roleId] ?? [];
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2.5">
      {specs.map((s) => {
        const id = `card-field-${s.key}`;
        if (s.kind === "photos") {
          return cardId ? <PhotoField key={s.key} cardId={cardId} disabled={disabled} /> : null;
        }
        if (s.kind === "check") {
          return (
            <label key={s.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-surface-2 px-3.5">
              <input
                type="checkbox"
                className="size-5 accent-[var(--accent)]"
                checked={values[s.key] === true}
                onChange={(e) => onChange(s.key, e.target.checked)}
              />
              <span className="text-[15px] font-medium">
                {s.label}
                {required(s)}
              </span>
            </label>
          );
        }
        if (s.kind === "choice") {
          return (
            <div key={s.key} role="radiogroup" aria-label={s.label} className="rounded-2xl bg-surface-2 px-3.5 py-2.5">
              <p className="mb-1.5 text-[13px] font-medium text-text-2">
                {s.label}
                {required(s)}
              </p>
              <div className="flex flex-wrap gap-2">
                {s.options!.map((o) => (
                  <label
                    key={o.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold ${
                      values[s.key] === o.value ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name={id}
                      className="sr-only"
                      checked={values[s.key] === o.value}
                      onChange={() => onChange(s.key, o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          );
        }
        const list = s.kind === "catalog" ? `${id}-list` : undefined;
        return (
          <div key={s.key}>
            <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-text-2">
              {s.label}
              {required(s)}
            </label>
            <input
              id={id}
              className="field"
              list={list}
              value={typeof values[s.key] === "string" ? (values[s.key] as string) : ""}
              placeholder={placeholders[s.key]}
              onChange={(e) => onChange(s.key, e.target.value)}
            />
            {list && (
              <datalist id={list}>
                {(s.key === "material" ? materialsFor(roleId) : []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
