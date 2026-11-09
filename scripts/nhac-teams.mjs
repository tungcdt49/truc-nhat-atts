// Nhắc trực nhật ATTS qua Microsoft Teams
// Chạy bởi GitHub Actions (xem .github/workflows/nhac-truc-nhat.yml)
// Biến môi trường:
//   TEAMS_WEBHOOK_URL  link webhook của Teams Workflows (bắt buộc, để trong GitHub Secrets)
//   APP_URL            link app GitHub Pages (để hiện nút "Mở app")
//   MODE               "sang" (gửi lịch đầy đủ) | "chieu" (chỉ nhắc việc chưa làm). Bỏ trống: tự chọn theo giờ.
//   DRY_RUN=1          chỉ in nội dung ra màn hình, không gửi

const FIREBASE = {
  apiKey: "AIzaSyC1Hch_Xg0Q3jKOHFXSSFmJqe6On8PP-tE",
  projectId: "atts-truc-nhat",
};
const TZ = "Asia/Ho_Chi_Minh";

// ---------- ngày giờ theo giờ Việt Nam ----------
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d || 1, 12)); };
const addDays = (k, n) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const dow = (k) => parse(k).getUTCDay();
function vnNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WDL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const dShort = (k) => `${WD[dow(k)]} ${k.slice(8, 10)}/${k.slice(5, 7)}`;
const money = (n) => (Number(n) || 0).toLocaleString("vi-VN") + "đ";

// ---------- đọc Firestore ----------
function decode(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

async function signIn() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!r.ok) throw new Error("Không đăng nhập được Firebase: " + (await r.text()));
  return (await r.json()).idToken;
}
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
async function getDoc(token, path) {
  const r = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Lỗi đọc ${path}: ` + (await r.text()));
  return decodeFields((await r.json()).fields || {});
}
async function listCol(token, col) {
  const out = []; let pageToken = "";
  do {
    const r = await fetch(`${BASE}/${col}?pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Lỗi đọc ${col}: ` + (await r.text()));
    const j = await r.json();
    for (const d of j.documents || []) out.push({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) });
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// ---------- tính lượt (giống logic trong app) ----------
function makeLogic(cfg, today) {
  const M = cfg.members || [];
  const isOff = (k) => (cfg.offDays || []).includes(dow(k));
  const validDay = (k) => { let g = 0; while (isOff(k) && g++ < 7) k = addDays(k, 1); return k; };
  const monday = (k) => addDays(k, -((dow(k) + 6) % 7));
  const keyOf = (f, dk) => (f === "day" ? dk : f === "week" ? monday(dk) : dk.slice(0, 7));
  const curKey = (f) => keyOf(f, today);
  const nextKey = (f, k) => {
    if (f === "day") return validDay(addDays(k, 1));
    if (f === "week") return addDays(k, 7);
    let [y, m] = k.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${pad(m)}`;
  };
  const idx = (id) => { const i = M.findIndex((m) => m.id === id); return i < 0 ? 0 : i; };
  const nextMember = (id) => (M.length ? M[(idx(id) + 1) % M.length].id : null);
  const byId = (id) => M.find((m) => m.id === id);
  // Nghỉ ốm / công tác: bỏ qua người vắng cả kỳ (kỳ đang chạy chỉ xét những ngày còn lại)
  const absOn = (mid, dk) => (cfg.absences || []).find((a) => a.memberId === mid && a.from <= dk && dk <= a.to);
  const periodDays = (f, key) => {
    if (f === "day") return [key];
    const out = []; let d = f === "week" ? key : key + "-01", g = 0;
    while (g++ < 31 && (f === "week" ? d <= addDays(key, 6) : d.slice(0, 7) === key)) { if (!isOff(d)) out.push(d); d = addDays(d, 1); }
    const rest = out.filter((x) => x >= today); return rest.length ? rest : out;
  };
  const absentFor = (mid, f, key) => { const ds = periodDays(f, key); return ds.length > 0 && ds.every((d) => absOn(mid, d)); };
  const size = Math.max(1, Math.min(4, Number(cfg.perTurn) || 1));
  const pickTeam = (startId, f, key) => {
    if (!M.length) return []; const i = idx(startId), out = [];
    for (let k = 0; k < M.length && out.length < size; k++) { const m = M[(i + k) % M.length]; if (!absentFor(m.id, f, key)) out.push(m); }
    if (!out.length) out.push(M[i % M.length]); return out;
  };
  // Mô phỏng phần "quên → nhắc → phạt" mà app sẽ làm khi có người mở
  function effective(t) {
    const n = { ...t, miss: t.miss || 0 }; const ck = curKey(n.freq); let g = 0; let fined = false;
    if (n.freq === "day") n.dueKey = validDay(n.dueKey);
    while (n.dueKey < ck && g++ < 90) {
      const team = pickTeam(n.curId, n.freq, n.dueKey); const mem = team[0]; if (!mem) break;
      n.curId = mem.id; n.miss++;
      if (n.miss > (cfg.reminders ?? 2)) { n.miss = 0; n.curId = nextMember(team[team.length - 1].id); fined = team.map((x) => x.name).join(" & "); }
      n.dueKey = nextKey(n.freq, n.dueKey);
    }
    return { ...n, fined, due: n.dueKey <= ck, person: pickTeam(n.curId, n.freq, n.dueKey).map((x) => x.name).join(" & ") || "(chưa có người)" };
  }
  const away = (cfg.absences || []).filter((a) => a.from <= today && today <= a.to && byId(a.memberId));
  return { isOff, effective, away };
}

// ---------- soạn tin ----------
const GROUPS = [["vp", "Cả văn phòng"], ["stay", "Ở lại văn phòng"]];
function groupLines(gcfg, gtasks, today) {
  const { isOff, effective, away } = makeLogic(gcfg, today);
  const reminders = gcfg.reminders ?? 2, fine = gcfg.fine ?? 50000;
  const label = { day: "", week: " (trong tuần)", month: " (trong tháng)" };
  const lines = [];
  const sorted = [...gtasks].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const t of sorted) {
    if (t.freq === "day" && isOff(today)) continue;
    const e = effective(t);
    if (!e.due) continue;
    let extra = "";
    if (e.miss > 0) {
      const left = reminders - e.miss + 1;
      extra = e.miss >= reminders
        ? ` — nhắc lần ${e.miss}/${reminders}, quên nữa sẽ bị phạt ${money(fine)}`
        : ` — nhắc lần ${e.miss}/${reminders}, quên thêm ${left} lần sẽ bị phạt`;
    }
    lines.push({ text: `**${t.name}**${label[t.freq]}: **${e.person}**${extra}`, warn: e.miss > 0 });
    if (e.fined) lines.push({ text: `${e.fined} đã quên quá ${reminders} lần việc "${t.name}" và bị phạt ${money(fine)}.`, warn: true });
  }
  return { lines, away, off: isOff(today) };
}

function buildCard({ cfg, cfgStay, tasks, notes, today, mode, appUrl }) {
  const ABS_R = { om: "ốm", ct: "công tác", phep: "nghỉ phép", khac: "vắng" };
  const groupOf = (t) => (t.group === "stay" ? "stay" : "vp");
  const sections = GROUPS.map(([g, title]) => {
    const gcfg = g === "stay" ? { ...cfg, members: cfgStay?.members || [], offDays: cfgStay?.offDays || [], perTurn: cfgStay?.perTurn ?? 2 } : cfg;
    return { g, title, gcfg, ...groupLines(gcfg, tasks.filter((t) => groupOf(t) === g), today) };
  });
  const lines = sections.flatMap((x) => x.lines);
  const awayMap = new Map();
  sections.forEach((x) => x.away.forEach((a) => awayMap.set(a.id, { ...a, name: (x.gcfg.members || []).find((m) => m.id === a.memberId)?.name })));
  const away = [...awayMap.values()];
  const withHeaders = sections.filter((x) => x.lines.length).length > 1 || sections[1].lines.length > 0;

  const open = notes.filter((n) => !n.done);
  const owe = {};
  notes.filter((n) => n.done && (n.amount || 0) > 0 && !n.reimbursed)
    .forEach((n) => { owe[n.buyerName || "?"] = (owe[n.buyerName || "?"] || 0) + n.amount; });

  if (mode === "chieu" && !lines.length) return null;       // chiều: chỉ gửi khi còn việc chưa làm
  if (mode === "sang" && !lines.length && !open.length) return null;

  const body = [
    { type: "TextBlock", size: "Large", weight: "Bolder", color: "Attention", wrap: true,
      text: mode === "chieu" ? "Nhắc lại: còn việc trực nhật chưa làm" : `Trực nhật hôm nay · ${WDL[dow(today)]} ${today.slice(8, 10)}/${today.slice(5, 7)}` },
    { type: "TextBlock", isSubtle: true, spacing: "None", wrap: true, text: "ATTS · Văn phòng Ocean Park 1" },
  ];
  if (lines.length) {
    for (const x of sections) {
      if (!x.lines.length) continue;
      if (withHeaders) body.push({ type: "TextBlock", weight: "Bolder", spacing: "Medium", text: x.title });
      x.lines.forEach((l) => body.push({ type: "TextBlock", wrap: true, text: "- " + l.text, color: l.warn ? "Warning" : "Default", spacing: "Small" }));
    }
    body.push({ type: "TextBlock", wrap: true, isSubtle: true, size: "Small",
      text: "Làm xong nhớ mở app bấm \"Đã làm xong\" để chuyển lượt cho người tiếp theo." });
  } else if (sections.every((x) => x.off)) {
    body.push({ type: "TextBlock", wrap: true, text: "Hôm nay là ngày nghỉ, không có việc trực." });
  }
  if (mode === "sang" && away.length) {
    body.push({ type: "TextBlock", wrap: true, isSubtle: true, spacing: "Small",
      text: "Đang nghỉ: " + away.map((a) => `${a.name} (${ABS_R[a.reason] || "vắng"}, đến ${dShort(a.to)})`).join("; ") });
  }
  if (mode === "sang" && open.length) {
    body.push({ type: "TextBlock", weight: "Bolder", text: `Việc phát sinh đang chờ (${open.length})`, spacing: "Medium" });
    open.slice(0, 6).forEach((n) => body.push({ type: "TextBlock", wrap: true, spacing: "None", text: `- ${n.title}${n.note ? ` · ${n.note}` : ""}` }));
    if (open.length > 6) body.push({ type: "TextBlock", spacing: "None", isSubtle: true, text: `...và ${open.length - 6} việc khác` });
  }
  if (mode === "sang" && Object.keys(owe).length) {
    body.push({ type: "TextBlock", weight: "Bolder", text: "Tiền ứng chờ hoàn lại", spacing: "Medium" });
    body.push({ type: "TextBlock", wrap: true, spacing: "None", text: Object.entries(owe).map(([k, v]) => `${k}: ${money(v)}`).join(" · ") });
  }
  const card = { type: "AdaptiveCard", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", version: "1.4", body };
  if (appUrl) {
    body.push({ type: "TextBlock", wrap: true, spacing: "Medium", text: `[Mở app trực nhật](${appUrl})` });
    card.actions = [{ type: "Action.OpenUrl", title: "Mở app trực nhật", url: appUrl }];
  }
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }] };
}

// ---------- chạy ----------
async function main() {
  const { today, hour } = vnNow();
  const mode = (process.env.MODE || "").trim() || (hour < 12 ? "sang" : "chieu");
  let cfg, cfgStay, tasks, notes;
  if (process.env.MOCK) {
    ({ cfg, cfgStay, tasks, notes } = JSON.parse(await (await import("node:fs/promises")).readFile(process.env.MOCK, "utf8")));
  } else {
    const token = await signIn();
    cfg = (await getDoc(token, "config/main")) || {};
    cfgStay = (await getDoc(token, "config/stay").catch(() => null)) || {};
    tasks = await listCol(token, "tasks");
    notes = await listCol(token, "notes").catch(() => []);
  }
  const msg = buildCard({ cfg, cfgStay, tasks, notes, today: process.env.TODAY || today, mode, appUrl: process.env.APP_URL || "" });
  if (!msg) { console.log(`[${mode}] Không có gì cần nhắc hôm nay.`); return; }
  if (process.env.DRY_RUN || !process.env.TEAMS_WEBHOOK_URL) {
    console.log(JSON.stringify(msg, null, 2));
    if (!process.env.TEAMS_WEBHOOK_URL) console.log("Chưa có TEAMS_WEBHOOK_URL nên chỉ in ra, không gửi.");
    return;
  }
  const r = await fetch(process.env.TEAMS_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
  if (!r.ok && r.status !== 202) throw new Error(`Teams trả lỗi ${r.status}: ${await r.text()}`);
  console.log(`[${mode}] Đã gửi nhắc vào Teams (${r.status}).`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
