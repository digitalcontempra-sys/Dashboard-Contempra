import { useEffect, useRef } from "react";
import {
  computeTotals,
  REQUIRED_TEXTS,
  SERVICE_KINDS,
  type DocketForm,
} from "../../shared/docketForm";

/** Paper replica of the Contempra Signs docket. Values are drawn in "pen blue", like the handwritten original. */

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" });
export const formatMoney = (n: number) => money.format(n);

const RULE = "border-[#1b1b1b]";
const LABEL = "shrink-0 text-[11px] font-bold tracking-wide text-[#1b1b1b] uppercase";
const INK = "w-full min-w-0 self-stretch min-h-11 bg-transparent text-[15px] font-medium text-[#1f3fa6] outline-none placeholder:text-[#9aa3b5] read-only:cursor-default focus:bg-[#eef3ff]";

type Props = {
  form: DocketForm;
  onChange?: (f: DocketForm) => void;
  readOnly?: boolean;
  showPrices: boolean;
  workOrder: string | null;
  salespeople?: string[];
};

export function DocketPaper({ form, onChange, readOnly = false, showPrices, workOrder, salespeople = [] }: Props) {
  const set = <K extends keyof DocketForm>(k: K, v: DocketForm[K]) => onChange?.({ ...form, [k]: v });
  const totals = computeTotals(form);
  const ctx: Ctx = { form, set, readOnly };

  return (
    <article
      className={`mx-auto w-full max-w-[1000px] rounded-[6px] border ${RULE} bg-white text-[#1b1b1b] shadow-[0_18px_50px_-20px_rgb(0_0_0/0.35)]`}
      aria-label="Docket"
    >
      {/* Title row */}
      <div className={`flex flex-wrap items-end gap-x-6 gap-y-1 border-b-2 ${RULE} px-3 pt-3 pb-2`}>
        <h2 className="text-[26px] leading-none font-black tracking-tight">CONTEMPRA SIGNS</h2>
        <label className="flex min-w-36 flex-1 items-end gap-2">
          <span className="text-[17px] font-semibold whitespace-nowrap">Quote #</span>
          <input aria-label="Quote #" className={`${INK} border-b ${RULE}`} value={form.quoteNo} readOnly={readOnly} onChange={(e) => set("quoteNo", e.target.value)} />
        </label>
        <p className="flex items-end gap-2 text-[17px] font-semibold whitespace-nowrap">
          Work Order #
          <span className="min-w-24 border-b border-[#1b1b1b] text-[20px] font-bold text-[#1f3fa6]" data-testid="work-order">
            {workOrder ?? "New"}
          </span>
        </p>
      </div>

      {/* Header block */}
      <div className={`grid grid-cols-1 border-b ${RULE} md:grid-cols-[1.25fr_1fr]`}>
        <div className={`md:border-r ${RULE}`}>
          <label className={`flex min-h-11 items-center gap-2 border-b ${RULE} px-2`}>
            <span className={LABEL}>DATE</span>
            <input aria-label="DATE" type="date" className={INK} value={form.date} readOnly={readOnly} onChange={(e) => set("date", e.target.value)} />
          </label>
          <Line ctx={ctx} label="FOR" field="forName" />
          <Line ctx={ctx} label="ADDRESS" field="address" />
          <Line ctx={ctx} label="CONTACT" field="contact" />
          <div className="grid grid-cols-2">
            <Line ctx={ctx} label="PHONE" field="phone" type="tel" inputMode="tel" className={`border-r ${RULE}`} />
            <Line ctx={ctx} label="FAX" field="fax" type="tel" inputMode="tel" />
          </div>
          <Line ctx={ctx} label="EMAIL" field="email" type="email" inputMode="email" className="border-b-0" />
        </div>
        <div className="grid grid-cols-[1fr_auto]">
          <div className={`border-r ${RULE}`}>
            <div className={`flex min-h-11 flex-wrap items-center gap-2 border-b ${RULE} px-2 py-1`}>
              <span className={LABEL}>REQUIRED</span>
              <input
                aria-label="REQUIRED date"
                type="date"
                className={`${INK} max-w-40`}
                value={form.required.kind === "date" ? form.required.date : ""}
                readOnly={readOnly}
                onChange={(e) => set("required", e.target.value ? { kind: "date", date: e.target.value } : { kind: "none" })}
              />
              {REQUIRED_TEXTS.map((t) => {
                const on = form.required.kind === "text" && form.required.text === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={on}
                    onClick={() => set("required", on ? { kind: "none" } : { kind: "text", text: t })}
                    className={`min-h-11 rounded-full border px-3 text-[11px] font-bold ${on ? "border-[#c8102e] bg-[#c8102e] text-white" : "border-[#1b1b1b]/40 text-[#1b1b1b]"}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <Line ctx={ctx} label="P.O. No." field="poNo" />
            <Line ctx={ctx} label="INVOICE No." field="invoiceNo" />
            <Line ctx={ctx} label="ORDER TAKEN BY" field="orderTakenBy" />
            <label className={`flex min-h-11 items-center gap-2 px-2`}>
              <span className={LABEL}>SALESPERSON</span>
              <input
                aria-label="SALESPERSON"
                list="salespeople"
                className={`${INK} uppercase`}
                value={form.salesperson}
                readOnly={readOnly}
                onChange={(e) => set("salesperson", e.target.value.toUpperCase())}
              />
              <datalist id="salespeople">
                {salespeople.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="flex flex-col justify-center px-3 py-2">
            <Check ctx={ctx} label="C.O.D." field="cod" />
            <Check ctx={ctx} label="Charge" field="charge" />
            <Check ctx={ctx} label="New Account" field="newAccount" />
            <Check ctx={ctx} label="Repeat" field="repeat" />
          </div>
        </div>
      </div>

      <p className={`border-b ${RULE} py-1.5 text-center text-[12px] font-semibold tracking-wide`}>FILL OUT ALL DETAILS COMPLETELY</p>

      {/* Body + right column */}
      <div className="grid grid-cols-1 md:grid-cols-[1.45fr_1fr]">
        <div className={`flex flex-col md:border-r ${RULE}`}>
          <p className={`border-b ${RULE} px-2 py-1.5 text-[11.5px] font-semibold tracking-wide`}>
            QUANTITY • COLOUR • SIZE • MATERIALS • SINGLE/DOUBLE SIDED
          </p>
          <div className="px-2 pt-2">
            <Check ctx={ctx} label="PROOF REQUIRED" field="proofRequired" />
          </div>
          <AutoTextarea
            value={form.body}
            readOnly={readOnly}
            onChange={(v) => set("body", v)}
          />
          <div className={`border-t ${RULE} px-2 py-2`}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Service">
              {SERVICE_KINDS.map((k) => {
                const on = form.service.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={on}
                    onClick={() => set("service", on ? form.service.filter((s) => s !== k) : [...form.service, k])}
                    className={`min-h-11 rounded-full border px-3 text-[11.5px] font-bold ${on ? "border-[#1f3fa6] bg-[#1f3fa6] text-white" : "border-[#1b1b1b]/40"}`}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <div className="mt-1">
              <Check ctx={ctx} label="CALL WHEN READY" field="callWhenReady" />
            </div>
          </div>
          <Line ctx={ctx} label="GOODS RECEIVED BY" field="goodsReceivedBy" className={`border-t border-b-0 ${RULE}`} />
        </div>

        <div className={`border-t ${RULE} md:border-t-0`}>
          <h3 className={`border-b ${RULE} py-1 text-center text-[12px] font-bold`}>LABOUR</h3>
          <table className="w-full table-fixed border-collapse text-[11px]">
            <thead>
              <tr className={`border-b ${RULE}`}>
                {["NAME", "WORK", "HRS.", "DATE"].map((h, i) => (
                  <th key={h} className={`py-1 font-semibold ${i < 3 ? `border-r ${RULE}` : ""} ${h === "HRS." ? "w-12" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.labour.map((l, i) => (
                <tr key={i} className={`border-b ${RULE}`}>
                  {(["name", "work", "hrs", "date"] as const).map((k, j) => (
                    <td key={k} className={j < 3 ? `border-r ${RULE}` : ""}>
                      <input
                        aria-label={`${{ name: "NAME", work: "WORK", hrs: "HRS", date: "DATE" }[k]} ${i + 1}`}
                        className={`${INK} h-11 px-1 text-[13px]`}
                        inputMode={k === "hrs" ? "decimal" : undefined}
                        value={l[k]}
                        readOnly={readOnly}
                        onChange={(e) => set("labour", form.labour.map((x, xi) => (xi === i ? { ...x, [k]: e.target.value } : x)))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full table-fixed border-collapse text-[11px]">
            <thead>
              <tr className={`border-b ${RULE}`}>
                <th className={`py-1 font-semibold border-r ${RULE}`}>MATERIALS</th>
                <th className="w-24 py-1 font-semibold">COST</th>
              </tr>
            </thead>
            <tbody>
              {form.materials.map((m, i) => (
                <tr key={i} className={`border-b ${RULE}`}>
                  <td className={`border-r ${RULE}`}>
                    <input
                      aria-label={`MATERIAL ${i + 1}`}
                      className={`${INK} h-11 px-1 text-[13px]`}
                      value={m.name}
                      readOnly={readOnly}
                      onChange={(e) => set("materials", form.materials.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    {showPrices && (
                      <input
                        aria-label={`COST ${i + 1}`}
                        className={`${INK} h-11 px-1 text-right text-[13px]`}
                        inputMode="decimal"
                        value={m.cost}
                        readOnly={readOnly}
                        onChange={(e) => set("materials", form.materials.map((x, xi) => (xi === i ? { ...x, cost: e.target.value } : x)))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Line ctx={ctx} label="SAVED AS" field="savedAs" />

          <dl className="text-[12px]">
            <TotalRow label="TOTAL" value={showPrices ? formatMoney(totals.total) : ""} />
            <TotalInput label="DELIVERY" show={showPrices} value={form.delivery} readOnly={readOnly} onChange={(v) => set("delivery", v)} />
            <TotalInput
              label="G.S.T."
              show={showPrices}
              value={form.gst ?? ""}
              placeholder={formatMoney(totals.gst)}
              readOnly={readOnly}
              onChange={(v) => set("gst", v === "" ? null : v)}
            />
            <TotalInput
              label="P.S.T."
              show={showPrices}
              value={form.pst ?? ""}
              placeholder={formatMoney(totals.pst)}
              readOnly={readOnly}
              onChange={(v) => set("pst", v === "" ? null : v)}
            />
            <TotalRow label="SUB-TOTAL" value={showPrices ? formatMoney(totals.subtotal) : ""} />
            <TotalInput label="DEPOSIT" show={showPrices} value={form.deposit} readOnly={readOnly} onChange={(v) => set("deposit", v)} />
            <div className={`flex min-h-11 items-center justify-between border-t-2 ${RULE} px-2`}>
              <dt className="text-[13px] font-black">GRAND TOTAL</dt>
              <dd className="text-[16px] font-bold text-[#1f3fa6]" data-testid="grand-total">
                {showPrices ? formatMoney(totals.grandTotal) : ""}
              </dd>
            </div>
            {showPrices && toNumber(form.deposit) > 0 && (
              <p className="px-2 pb-2 text-right text-[11px] text-[#555]">Balance due {formatMoney(totals.balanceDue)}</p>
            )}
          </dl>
        </div>
      </div>
      <p className={`border-t ${RULE} px-2 py-1 text-[10px] text-[#555]`}>IF ADDITIONAL SPACE IS REQUIRED, USE REVERSE SIDE</p>
    </article>
  );
}


type TextField =
  | "quoteNo" | "forName" | "address" | "contact" | "phone" | "fax" | "email"
  | "poNo" | "invoiceNo" | "orderTakenBy" | "savedAs" | "goodsReceivedBy";
type CheckField = "cod" | "charge" | "newAccount" | "repeat" | "proofRequired" | "callWhenReady";
type Ctx = { form: DocketForm; set: <K extends keyof DocketForm>(k: K, v: DocketForm[K]) => void; readOnly: boolean };

// Defined at module level so inputs keep focus between renders.
function Line({ ctx, label, field, type = "text", className = "", inputMode }: {
  ctx: Ctx;
  label: string;
  field: TextField;
  type?: string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className={`flex min-h-11 items-center gap-2 border-b ${RULE} px-2 ${className}`}>
      <span className={LABEL}>{label}</span>
      <input
        aria-label={label}
        className={INK}
        type={type}
        inputMode={inputMode}
        value={ctx.form[field]}
        readOnly={ctx.readOnly}
        onChange={(e) => ctx.set(field, e.target.value)}
      />
    </label>
  );
}

function Check({ ctx, label, field }: { ctx: Ctx; label: string; field: CheckField }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-[12px] font-semibold text-[#1b1b1b]">
      <input
        type="checkbox"
        aria-label={label}
        className="size-5 accent-[#1f3fa6]"
        checked={ctx.form[field]}
        disabled={ctx.readOnly}
        onChange={(e) => ctx.set(field, e.target.checked)}
      />
      {label}
    </label>
  );
}

const toNumber = (s: string) => Number.parseFloat(s.replace(/[$,\s]/g, "")) || 0;

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={`flex min-h-11 items-center justify-between border-t ${RULE} px-2`}>
      <dt className="font-semibold">{label}</dt>
      <dd className="font-semibold text-[#1f3fa6]">{value}</dd>
    </div>
  );
}

function TotalInput({
  label,
  show,
  value,
  placeholder,
  readOnly,
  onChange,
}: {
  label: string;
  show: boolean;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-2 border-t ${RULE} px-2`}>
      <dt className="font-semibold">{label}</dt>
      <dd className="w-28">
        {show && (
          <input
            aria-label={label}
            className={`${INK} text-right text-[13px]`}
            inputMode="decimal"
            value={value}
            placeholder={placeholder}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </dd>
    </div>
  );
}

/** The free-writing area of the docket; grows with its content like the paper's open space. */
function AutoTextarea({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 360)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label="Job details"
      className="min-h-[360px] w-full flex-1 resize-none bg-[repeating-linear-gradient(transparent,transparent_31px,#d9dee8_31px,#d9dee8_32px)] bg-local px-3 pt-1 text-[17px] leading-8 font-medium text-[#1f3fa6] outline-none read-only:cursor-default"
      value={value}
      readOnly={readOnly}
      placeholder={readOnly ? "" : "Write the job here, as on the paper docket…"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
