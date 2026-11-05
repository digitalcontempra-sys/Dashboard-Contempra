import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { computeTotals, SERVICE_KINDS, type DocketForm } from "../../shared/docketForm";

/** Vector PDF of the paper docket (LETTER). Same boxes and labels as DocketPaper; values in pen blue. */

const INK = "#1f3fa6";
const LINE = "#1b1b1b";
const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", currencyDisplay: "narrowSymbol" });

const s = StyleSheet.create({
  page: { padding: 24, fontFamily: "Helvetica", fontSize: 8, color: LINE },
  sheet: { borderWidth: 1, borderColor: LINE, flexGrow: 1 },
  row: { flexDirection: "row" },
  bb: { borderBottomWidth: 1, borderColor: LINE },
  br: { borderRightWidth: 1, borderColor: LINE },
  bt: { borderTopWidth: 1, borderColor: LINE },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7, textTransform: "uppercase", marginRight: 4 },
  value: { color: INK, fontSize: 10, flexGrow: 1 },
  line: { flexDirection: "row", alignItems: "center", minHeight: 18, paddingHorizontal: 4 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20 },
  cell: { paddingHorizontal: 3, paddingVertical: 3, minHeight: 15, justifyContent: "center" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7, textAlign: "center" },
  body: { color: INK, fontSize: 11, lineHeight: 1.45, padding: 6 },
});

function Line({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.line, last ? {} : s.bb]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

const box = (on: boolean) => (on ? "[X]" : "[  ]");

export function DocketPdf({ form, workOrder, showPrices }: { form: DocketForm; workOrder: string; showPrices: boolean }) {
  const t = computeTotals(form);
  const m = (n: number) => (showPrices ? money.format(n) : "");
  const required =
    form.required.kind === "date" ? form.required.date : form.required.kind === "text" ? form.required.text : "";

  return (
    <Document title={`Docket ${workOrder} - ${form.forName}`} author="Contempra Signs" creator="Contempra Dashboard">
      <Page size="LETTER" style={s.page}>
        <View style={s.sheet}>
          <View style={[s.row, s.bb, { alignItems: "flex-end", padding: 6, borderBottomWidth: 2 }]}>
            <Text style={s.title}>CONTEMPRA SIGNS</Text>
            <Text style={{ fontSize: 12, marginLeft: 16 }}>Quote # </Text>
            <Text style={[s.value, { fontSize: 12 }]}>{form.quoteNo}</Text>
            <Text style={{ fontSize: 12 }}>Work Order # </Text>
            <Text style={{ fontSize: 14, color: INK, fontFamily: "Helvetica-Bold" }}>{workOrder}</Text>
          </View>

          <View style={[s.row, s.bb]}>
            <View style={[{ width: "56%" }, s.br]}>
              <Line label="DATE" value={form.date} />
              <Line label="FOR" value={form.forName} />
              <Line label="ADDRESS" value={form.address} />
              <Line label="CONTACT" value={form.contact} />
              <View style={[s.row, s.bb]}>
                <View style={[{ width: "50%" }, s.br]}>
                  <Line label="PHONE" value={form.phone} last />
                </View>
                <View style={{ width: "50%" }}>
                  <Line label="FAX" value={form.fax} last />
                </View>
              </View>
              <Line label="EMAIL" value={form.email} last />
            </View>
            <View style={[{ width: "44%" }, s.row]}>
              <View style={[{ flexGrow: 1 }, s.br]}>
                <Line label="REQUIRED" value={required} />
                <Line label="P.O. No." value={form.poNo} />
                <Line label="INVOICE No." value={form.invoiceNo} />
                <Line label="ORDER TAKEN BY" value={form.orderTakenBy} />
                <Line label="SALESPERSON" value={form.salesperson} last />
              </View>
              <View style={{ width: 70, padding: 4, justifyContent: "center" }}>
                <Text>{box(form.cod)} C.O.D.</Text>
                <Text>{box(form.charge)} Charge</Text>
                <Text>{box(form.newAccount)} New Account</Text>
                <Text>{box(form.repeat)} Repeat</Text>
              </View>
            </View>
          </View>

          <Text style={[s.bb, { textAlign: "center", paddingVertical: 3, fontFamily: "Helvetica-Bold" }]}>
            FILL OUT ALL DETAILS COMPLETELY
          </Text>

          <View style={[s.row, { flexGrow: 1 }]}>
            <View style={[{ width: "56%" }, s.br]}>
              <Text style={[s.bb, { padding: 3, fontFamily: "Helvetica-Bold", fontSize: 7 }]}>
                QUANTITY • COLOUR • SIZE • MATERIALS • SINGLE/DOUBLE SIDED
              </Text>
              <Text style={{ padding: 4, fontFamily: "Helvetica-Bold" }}>{box(form.proofRequired)} PROOF REQUIRED</Text>
              <Text style={[s.body, { flexGrow: 1 }]}>{form.body}</Text>
              <View style={[s.bt, { padding: 4 }]}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>
                  {SERVICE_KINDS.map((k) => `${form.service.includes(k) ? "[X]" : "[  ]"} ${k}`).join("   ")}
                </Text>
                <Text style={{ marginTop: 4 }}>{box(form.callWhenReady)} CALL WHEN READY</Text>
              </View>
              <View style={s.bt}>
                <Line label="GOODS RECEIVED BY" value={form.goodsReceivedBy} last />
              </View>
            </View>

            <View style={{ width: "44%" }}>
              <Text style={[s.bb, s.th, { paddingVertical: 2 }]}>LABOUR</Text>
              <View style={[s.row, s.bb]}>
                {["NAME", "WORK", "HRS.", "DATE"].map((h, i) => (
                  <Text key={h} style={[s.th, s.cell, { width: ["32%", "32%", "12%", "24%"][i] }, i < 3 ? s.br : {}]}>
                    {h}
                  </Text>
                ))}
              </View>
              {form.labour.map((l, r) => (
                <View key={r} style={[s.row, s.bb]}>
                  {[l.name, l.work, l.hrs, l.date].map((v, i) => (
                    <Text key={i} style={[s.cell, { width: ["32%", "32%", "12%", "24%"][i], color: INK }, i < 3 ? s.br : {}]}>
                      {v}
                    </Text>
                  ))}
                </View>
              ))}
              <View style={[s.row, s.bb]}>
                <Text style={[s.th, s.cell, { width: "72%" }, s.br]}>MATERIALS</Text>
                <Text style={[s.th, s.cell, { width: "28%" }]}>COST</Text>
              </View>
              {form.materials.map((mat, r) => (
                <View key={r} style={[s.row, s.bb]}>
                  <Text style={[s.cell, { width: "72%", color: INK }, s.br]}>{mat.name}</Text>
                  <Text style={[s.cell, { width: "28%", color: INK, textAlign: "right" }]}>{showPrices ? mat.cost : ""}</Text>
                </View>
              ))}
              <Line label="SAVED AS" value={form.savedAs} />
              {[
                ["TOTAL", m(t.total)],
                ["DELIVERY", m(t.delivery)],
                ["G.S.T.", m(t.gst)],
                ["P.S.T.", m(t.pst)],
                ["SUB-TOTAL", m(t.subtotal)],
                ["DEPOSIT", m(t.deposit)],
              ].map(([label, value]) => (
                <View key={label} style={[s.row, s.bb, s.cell, { justifyContent: "space-between" }]}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{label}</Text>
                  <Text style={{ color: INK }}>{value}</Text>
                </View>
              ))}
              <View style={[s.row, s.cell, { justifyContent: "space-between", borderTopWidth: 1 }]}>
                <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>GRAND TOTAL</Text>
                <Text style={{ color: INK, fontSize: 11, fontFamily: "Helvetica-Bold" }}>{m(t.grandTotal)}</Text>
              </View>
            </View>
          </View>
          <Text style={[s.bt, { padding: 3, fontSize: 6 }]}>IF ADDITIONAL SPACE IS REQUIRED, USE REVERSE SIDE</Text>
        </View>
      </Page>
    </Document>
  );
}
