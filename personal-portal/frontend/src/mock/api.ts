// mock 모드 전용 (vite --mode mock): API 대신 가짜 데이터. 화면 점검(scripts/screens.mjs)용이라
// 일부러 긴 제목·많은 항목을 넣어 잘림·넘침을 드러낸다. 변경 요청은 받은 값을 그대로 돌려준다.
import { addDays, todayStr } from "@/lib/dates";

const T = todayStr();
const M = T.slice(0, 7);
const d = (n: number) => addDays(T, n);
const now = new Date().toISOString();
const LONG = "아주 긴 제목이 들어가면 화면에서 어떻게 보이는지 확인하기 위한 테스트 항목입니다";

const allEdit = { calendar: "edit", todo: "edit", health: "edit", boards: "edit", notes: "edit", ledger: "edit", hub: "edit", checklists: "edit" };
const me = { sub: "mock-host", email: "host@example.com", name: "이현행", role: "host", isHost: true, perms: allEdit };
const members = [
  { sub: "mock-host", name: "이현행", email: "host@example.com", role: "owner" },
  { sub: "u2", name: "김가족", email: "family@example.com", role: "editor" },
  { sub: "u3", name: "박팀원", email: "team@example.com", role: "viewer" },
];

const todos = [
  { id: "t1", title: "장보기", note: "", due: T, priority: "normal", subtasks: [], order: 1, done: false, createdAt: now },
  { id: "t2", title: LONG, note: "메모", due: T, dueTime: "18:30", priority: "high", listId: "l1", subtasks: [{ id: "s1", text: "하위 작업", done: true }, { id: "s2", text: "두 번째", done: false }], order: 2, done: false, createdAt: now },
  { id: "t3", title: "지난 마감 보고서", note: "", due: d(-2), priority: "high", subtasks: [], order: 3, done: false, createdAt: now },
  { id: "t4", title: "매주 분리수거", note: "", due: d(2), priority: "low", repeat: { freq: "weekly", weekdays: [3] }, subtasks: [], order: 4, done: false, createdAt: now },
  { id: "t5", title: "언젠가 할 일", note: "", priority: "normal", subtasks: [], order: 5, done: false, createdAt: now },
];
const events = [
  { id: "e1", title: "팀 회의", allDay: false, start: T, startTime: "10:00", end: T, endTime: "11:00", location: "회의실 A", color: "blue", memo: "" },
  { id: "e2", title: LONG, allDay: true, start: T, end: d(2), location: "", color: "green", memo: "" },
  { id: "e3", title: "병원 예약", allDay: false, start: d(3), startTime: "15:30", end: d(3), endTime: "16:00", location: "서울 강남구 어딘가 아주 긴 주소 123-45", color: "red", memo: "" },
  { id: "e4", title: "생일", allDay: true, start: d(7), end: d(7), location: "", color: "pink", memo: "", seriesId: "r1", occurrenceDate: d(7) },
  { id: "e5", title: "운동", allDay: false, start: d(1), startTime: "07:00", end: d(1), endTime: "08:00", location: "", color: "orange", memo: "" },
  { id: "e6", title: "저녁 약속", allDay: false, start: d(1), startTime: "19:00", end: d(1), endTime: "21:00", location: "", color: "purple", memo: "" },
];
const meals = [
  { id: "m1", date: T, meal: "breakfast", method: "ai", note: "", createdAt: now, name: "현미밥", grams: 210, kcal: 315, carb: 68, protein: 6, fat: 2 },
  { id: "m2", date: T, meal: "lunch", method: "manual", note: "", createdAt: now, name: "얼큰쌀국수 한 그릇 곱빼기 + 고수 추가", grams: 650, kcal: 720, carb: 98, protein: 32, fat: 18 },
  { id: "m3", date: T, meal: "snack", method: "food", note: "", createdAt: now, name: "아메리카노", grams: null, kcal: 10, carb: 1, protein: 0, fat: 0 },
];
const totals = { [T]: { kcal: 1045, carb: 167, protein: 38, fat: 20 } };
const weights = Array.from({ length: 40 }, (_, i) => ({ date: d(i - 39), weight: Math.round((74 - i * 0.05 + Math.sin(i) * 0.4) * 10) / 10, memo: "" }));
const runs = [
  { id: "r1", date: d(-1), distanceKm: 5.2, durationSec: 1620, paceSecPerKm: 311, type: "easy", effort: 5, kcal: 380, kcalEstimated: true, memo: "" },
  { id: "r2", date: d(-4), distanceKm: 10.1, durationSec: 3300, paceSecPerKm: 327, type: "long", kcal: 760, kcalEstimated: false, memo: LONG },
];
const gym = [
  { id: "g1", date: d(-2), title: "상체 A", routineId: "rt1", exercises: [{ name: "벤치프레스", sets: [{ reps: 10, weight: 60 }, { reps: 8, weight: 65 }] }, { name: "랫풀다운", sets: [{ reps: 12, weight: 45 }] }], kcal: 250, memo: "" },
];
const program = {
  id: "p1", name: "10K 대비 8주 프로그램", startDate: d(-10), weeks: 8, active: true, manualDone: [],
  items: [
    { week: 1, weekday: 1, kind: "run", title: "이지런 5km" }, { week: 1, weekday: 3, kind: "gym", title: "상체 A" }, { week: 2, weekday: 1, kind: "run", title: "인터벌 400m × 6" },
    { week: 2, weekday: 6, kind: "other", title: "스트레칭 30분" }, { week: 3, weekday: 2, kind: "run", title: LONG },
  ],
};
const boardCols = [
  { id: "c1", name: "할 일", order: 1, done: false },
  { id: "c2", name: "진행 중", order: 2, done: false },
  { id: "c3", name: "완료", order: 3, done: true },
];
const labels = [{ id: "lb1", name: "버그", color: "red" }, { id: "lb2", name: "기능", color: "blue" }, { id: "lb3", name: "", color: "green" }];
const card = (id: string, columnId: string, title: string, extra: object = {}) => ({
  id, columnId, order: Number(id.slice(1)), title, description: "", priority: "normal", labels: [], checklist: [], links: [], createdBy: "mock-host", createdAt: now, updatedAt: now, ...extra,
});
const cards = [
  card("k1", "c1", "로그인 화면 디자인", { labels: ["lb2"], assignee: "mock-host", due: d(1) }),
  card("k2", "c1", LONG, { priority: "high", labels: ["lb1", "lb2", "lb3"], due: d(-1), checklist: [{ id: "x", text: "a", done: true }, { id: "y", text: "b", done: false }], description: "설명" }),
  card("k3", "c2", "API 연결", { assignee: "u2", links: [{ title: "문서", url: "https://example.com" }] }),
  card("k4", "c3", "배포 파이프라인"),
];
const lists = [
  { id: "cl1", name: "장보기", icon: "🛒", ownerSub: "mock-host", createdAt: now, role: "owner", favorite: true, remaining: 4, total: 6, memberCount: 2 },
  { id: "cl2", name: "여행 준비물 아주 긴 이름의 체크리스트", icon: "🧳", ownerSub: "u2", createdAt: now, role: "editor", favorite: false, remaining: 0, total: 3, memberCount: 3 },
];
const listItems = [
  { id: "i1", text: "우유", done: false, order: 1, createdAt: now },
  { id: "i2", text: "계란 30구 (유정란으로, 없으면 일반 계란도 괜찮음)", done: false, order: 2, createdAt: now },
  { id: "i3", text: "두부", done: false, order: 3, createdAt: now },
  { id: "i4", text: "대파", done: false, order: 4, createdAt: now },
  { id: "i5", text: "식빵", done: true, doneBy: "u2", doneAt: now, order: 5, createdAt: now },
  { id: "i6", text: "사과", done: true, doneBy: "mock-host", doneAt: now, order: 6, createdAt: now },
];
const notes = [
  { id: "n1", title: "회의록", body: "# 주간 회의\n- 진행 상황 공유\n- **다음 주** 배포", tags: ["업무", "회의"], pinned: true, createdAt: now, updatedAt: now },
  { id: "n2", title: "", body: `${LONG}\n둘째 줄 내용`, tags: ["아이디어"], pinned: false, createdAt: now, updatedAt: now },
  { id: "n3", title: "레시피", body: "김치찌개 만드는 법", tags: [], pinned: false, createdAt: now, updatedAt: now },
];
const categories = [
  ...["식비", "카페·간식", "교통", "주거·통신", "생활용품", "쇼핑", "의료", "문화·여가", "경조사", "기타"].map((name, i) => ({ id: `ce${i}`, type: "expense", name, order: i + 1 })),
  ...["급여", "부수입", "기타"].map((name, i) => ({ id: `ci${i}`, type: "income", name, order: i + 1 })),
];
const txns = [
  { id: "x1", date: T, type: "expense", amount: 12000, categoryId: "ce0", method: "카드", memo: "점심" },
  { id: "x2", date: T, type: "expense", amount: 4500, categoryId: "ce1", method: "카드", memo: LONG },
  { id: "x3", date: d(-1), type: "expense", amount: 1250000, categoryId: "ce3", method: "계좌이체", memo: "월세", recurId: "rc1" },
  { id: "x4", date: d(-3), type: "income", amount: 3500000, categoryId: "ci0", method: "", memo: "월급" },
  { id: "x5", date: d(-5), type: "expense", amount: 89000, categoryId: "ce5", method: "현금", memo: "" },
].filter((t) => t.date.startsWith(M));
const hubItems = [
  { id: "h1", kind: "snippet", title: "AWS 계정 확인", lang: "bash", code: "aws sts get-caller-identity --profile personal-portal --query Account --output text", description: "", tags: ["aws"], favorite: true, collectionId: "hc1", createdAt: now, updatedAt: now },
  { id: "h2", kind: "link", title: "AWS 콘솔", url: "https://ap-northeast-2.console.aws.amazon.com/console/home?region=ap-northeast-2", description: "서울 리전", tags: ["aws"], favorite: true, createdAt: now, updatedAt: now },
  { id: "h3", kind: "snippet", title: LONG, lang: "python", code: Array.from({ length: 14 }, (_, i) => `print("line ${i}")`).join("\n"), description: "긴 코드", tags: ["python", "예제"], favorite: false, createdAt: now, updatedAt: now },
];
const adminUsers = [
  { sub: "mock-host", email: "host@example.com", name: "이현행", signupNote: "", status: "active", role: "host", createdAt: now },
  { sub: "u2", email: "family-member-with-long-address@example.com", name: "김가족", signupNote: "가족입니다", status: "active", role: "member", createdAt: now },
  { sub: "u4", email: "pending@example.com", name: "대기중", signupNote: "회사 동료 아주 긴 가입 메모가 들어가면 어떻게 보이나", status: "pending", role: "member", createdAt: now },
];

// 행컴퍼니 (docs/COMPANY.md)
const AREA_IDS = ["partners", "assets", "items", "contracts", "txns", "money", "docs", "reports", "settings"];
const allAreas = (lv: string) => Object.fromEntries(AREA_IDS.map((a) => [a, lv]));
const areas = (over: Record<string, string>) => ({ ...allAreas("none"), ...over });
const companyInfo = { id: "cp1", name: "행컴퍼니", bizNo: "123-45-67890", ceo: "이대표", address: "서울특별시 중구 세종대로 110 아주 긴 주소 테스트빌딩 12층", phone: "02-123-4567", email: "office@example.com", bankAccount: "국민은행 123456-01-234567 (행컴퍼니)", vatDefault: "excluded", createdAt: now };
const companyRoles = [
  { id: "admin", name: "관리자", isAdmin: true, showAmounts: true, perms: allAreas("edit") },
  { id: "accountant", name: "경리", isAdmin: false, showAmounts: true, perms: areas({ partners: "edit", assets: "view", items: "view", contracts: "view", txns: "edit", money: "edit", docs: "edit", reports: "edit" }) },
  { id: "office", name: "사무", isAdmin: false, showAmounts: true, perms: areas({ partners: "edit", assets: "edit", items: "edit", contracts: "edit", txns: "edit", money: "view", docs: "edit", reports: "view" }) },
  { id: "field", name: "현장 기사", isAdmin: false, showAmounts: false, perms: areas({ partners: "view", assets: "edit", items: "view", contracts: "view", txns: "edit", docs: "view" }) },
];


// 행컴퍼니 C2 기준 정보
const cpPartners = [
  { id: "pa1", name: "서울중앙초등학교", kind: "customer", contactName: "김행정", phone: "02-111-2222", address: "서울 중구 세종대로 1", active: true, receivable: 240000, advance: 0, payable: 0, createdAt: now },
  { id: "pa2", name: "한빛정형외과의원", kind: "customer", contactName: "이원무", phone: "02-333-4444", mobile: "010-1234-5678", active: true, receivable: 0, advance: 50000, payable: 0, createdAt: now },
  { id: "pa3", name: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", kind: "customer", contactName: "박실장", phone: "02-555-6666", active: true, receivable: 1320000, advance: 0, payable: 0, createdAt: now },
  { id: "pa4", name: "(주)대한오피스솔루션", kind: "supplier", contactName: "최영업", phone: "031-777-8888", bizNo: "111-22-33333", active: true, receivable: 0, advance: 0, payable: 3500000, createdAt: now },
  { id: "pa5", name: "구 거래처", kind: "both", active: false, receivable: 0, advance: 0, payable: 0, createdAt: now },
];
const cpItems = [
  { id: "it1", name: "신도리코 D420 컬러복합기", tracking: "asset", category: "복합기", maker: "신도리코", modelNo: "D420", spec: "A3 컬러, 분당 42매", unit: "대", price: 4500000, rentPrice: 120000, cost: 3200000, active: true, assetCounts: { in_stock: 2, rented: 5, repair: 1, retired: 0 }, createdAt: now },
  { id: "it2", name: "캐논 iR2630 흑백복합기", tracking: "asset", category: "복합기", maker: "캐논", modelNo: "iR2630", unit: "대", price: 2200000, rentPrice: 60000, active: true, assetCounts: { in_stock: 1, rented: 3, repair: 0, retired: 1 }, createdAt: now },
  { id: "it3", name: "HP 레이저젯 M404 프린터", tracking: "asset", category: "프린터", maker: "HP", unit: "대", price: 450000, rentPrice: 25000, active: true, assetCounts: { in_stock: 4, rented: 2, repair: 0, retired: 0 }, createdAt: now },
  { id: "it4", name: "D420 토너 검정", tracking: "stock", category: "토너", maker: "신도리코", unit: "개", price: 85000, cost: 52000, qty: 3, minStock: 5, compatibleWith: ["it1"], active: true, createdAt: now },
  { id: "it5", name: "D420 토너 파랑", tracking: "stock", category: "토너", unit: "개", price: 95000, qty: 8, minStock: 3, compatibleWith: ["it1"], active: true, createdAt: now },
  { id: "it6", name: "엡손 정품 잉크 (액상) 블랙 70ml", tracking: "stock", category: "잉크", unit: "병", price: 18000, qty: 24, minStock: 10, active: true, createdAt: now },
  { id: "it7", name: "A4 복사용지 80g (2500매)", tracking: "stock", category: "용지", unit: "박스", price: 28000, qty: 42, minStock: 20, active: true, createdAt: now },
  { id: "it8", name: "D420 정착기 유닛", tracking: "stock", category: "부품", unit: "개", price: 320000, qty: 1, minStock: 1, compatibleWith: ["it1"], active: true, createdAt: now },
];
const cpAssets = [
  { id: "as1", code: "A-000001", itemId: "it1", itemName: "신도리코 D420 컬러복합기", serial: "SD420-23A0001", status: "rented", partnerId: "pa1", partnerName: "서울중앙초등학교", location: "", acquiredAt: "2025-03-02", cost: 3200000, memo: "", contractId: "k1", lastReading: { date: d(-12), mono: 48210, color: 12055, note: "" }, createdAt: now },
  { id: "as2", code: "A-000002", itemId: "it1", itemName: "신도리코 D420 컬러복합기", serial: "SD420-23A0002", status: "rented", partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", location: "", cost: 3200000, memo: "", createdAt: now },
  { id: "as3", code: "A-000003", itemId: "it1", itemName: "신도리코 D420 컬러복합기", serial: "", status: "in_stock", location: "본사 창고 2층", memo: "", createdAt: now },
  { id: "as4", code: "A-000004", itemId: "it1", itemName: "신도리코 D420 컬러복합기", serial: "SD420-23A0004", status: "repair", location: "수리실", memo: "급지 불량", createdAt: now },
  { id: "as5", code: "A-000005", itemId: "it2", itemName: "캐논 iR2630 흑백복합기", serial: "CN2630-998877", status: "rented", partnerId: "pa2", partnerName: "한빛정형외과의원", location: "", memo: "", createdAt: now },
  { id: "as6", code: "A-000006", itemId: "it3", itemName: "HP 레이저젯 M404 프린터", serial: "VNB3K12345", status: "retired", location: "", memo: "폐기 처리", createdAt: now },
];
const cpAccounts = [
  { id: "ac1", name: "국민 주거래", kind: "bank", bank: "국민은행", number: "123456-01-234567", holder: "행컴퍼니", active: true, openingBalance: 12000000, balance: 15840000, createdAt: now },
  { id: "ac2", name: "현금 시재", kind: "cash", active: true, openingBalance: 300000, balance: 185000, createdAt: now },
];


// 행컴퍼니 C4 계약·청구·검침·A/S
const machine = (assetId: string, code: string, itemName: string, extra: object) => ({ assetId, code, itemName, startedAt: d(-200), startMono: 20000, startColor: 5000, billedMono: 46500, billedColor: 11800, billedReadAt: d(-40), counter: false, freeMono: 0, freeColor: 0, monthly: 0, overMono: 0, overColor: 0, ...extra });
const cpContracts = [
  { id: "k1", no: "C-2026-0001", partnerId: "pa1", partnerName: "서울중앙초등학교", status: "active", startDate: d(-200), billingDay: 25, vatMode: "excluded", memo: "교무실·행정실", billedThrough: "2026-09", createdAt: now, termEnd: d(20),
    machines: { as1: machine("as1", "A-000001", "신도리코 D420 컬러복합기", { monthly: 120000, counter: true, freeMono: 1000, freeColor: 300, overMono: 10, overColor: 80 }), as5: machine("as5", "A-000005", "캐논 iR2630 흑백복합기", { monthly: 60000, endedAt: d(-30) }) } },
  { id: "k2", no: "C-2026-0002", partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", status: "active", startDate: d(-90), billingDay: 31, vatMode: "excluded", memo: "", billedThrough: "2026-08", createdAt: now,
    machines: { as2: machine("as2", "A-000002", "신도리코 D420 컬러복합기", { monthly: 150000 }) } },
  { id: "k3", no: "C-2025-0007", partnerId: "pa2", partnerName: "한빛정형외과의원", status: "ended", startDate: "2025-04-01", endedAt: d(-60), billingDay: 10, vatMode: "included", memo: "", billedThrough: "2026-08", createdAt: now, machines: {} },
];
const pendingBills = [
  { contractId: "k2", contractNo: "C-2026-0002", partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", month: "2026-09", dueOn: "2026-09-30", final: false, behind: 2, counters: [],
    lines: [{ name: "9월 임대료 A-000002 신도리코 D420 컬러복합기", qty: 1, unitPrice: 150000, vatMode: "excluded", memo: "" }], warnings: [] },
  { contractId: "k1", contractNo: "C-2026-0001", partnerId: "pa1", partnerName: "서울중앙초등학교", month: "2026-10", dueOn: d(-1), final: false, behind: 1,
    counters: [{ assetId: "as1", code: "A-000001", fromMono: 46500, toMono: 48210, fromColor: 11800, toColor: 12055, readAt: d(-12) }],
    lines: [
      { name: "10월 임대료 A-000001 신도리코 D420 컬러복합기", qty: 1, unitPrice: 120000, vatMode: "excluded", memo: "" },
      { name: "A-000001 흑백 초과 710매", qty: 710, unitPrice: 10, vatMode: "excluded", memo: "사용 1,710매 − 기본 1,000매" },
      { name: "A-000005 캐논 iR2630 흑백복합기 일할 임대료가 붙은 아주 긴 줄 이름", qty: 1, unitPrice: 26000, vatMode: "excluded", memo: "일할 13/30일 (월 60,000원)" },
    ],
    warnings: ["검침 없음: A-000009 (지난 청구 이후)"] },
];
const readingRows = [
  { contractId: "k1", contractNo: "C-2026-0001", partnerId: "pa1", partnerName: "서울중앙초등학교", billingDay: 25, assetId: "as1", code: "A-000001", itemName: "신도리코 D420 컬러복합기", color: true, lastReading: { date: d(-50), mono: 46500, color: 11800 }, billedMono: 46500, billedColor: 11800, billedReadAt: d(-40) },
  { contractId: "k2", contractNo: "C-2026-0002", partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", billingDay: 31, assetId: "as2", code: "A-000002", itemName: "신도리코 D420 컬러복합기", color: false, billedMono: 0, billedColor: 0, billedReadAt: d(-90) },
];
const cpServices = [
  { id: "sv1", no: "AS-2026-0012", status: "open", date: T, partnerId: "pa1", partnerName: "서울중앙초등학교", assetId: "as1", assetCode: "A-000001", itemName: "신도리코 D420 컬러복합기", symptom: "용지 걸림이 하루에도 여러 번, 2단 카세트에서 소리가 남", contact: "행정실 김주무관 010-0000-0000", assignee: "u6", assigneeName: "박기사", createdAt: now },
  { id: "sv2", no: "AS-2026-0011", status: "done", date: d(-3), partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", assetId: "as2", assetCode: "A-000002", itemName: "신도리코 D420 컬러복합기", symptom: "인쇄물 세로 줄", contact: "", needsBilling: true, done: { date: d(-2), action: "드럼 청소, 정착기 점검", by: "u6", at: now }, txn: { id: "tx7", date: d(-2), no: "T-2026-00013" }, createdAt: now },
  { id: "sv3", no: "AS-2026-0010", status: "canceled", date: d(-9), partnerId: "pa2", partnerName: "한빛정형외과의원", symptom: "토너 교체 요청", contact: "", cancelReason: "고객이 직접 교체", createdAt: now },
];

// 행컴퍼니 C5 문서
const cpDocs = [
  { id: "dc1", no: "R-2026-0003", type: "receipt", title: "영수증", date: T, partnerId: "pa2", partnerName: "한빛정형외과의원", sources: [{ kind: "txn", id: "tx2", date: T, no: "T-2026-00011" }], total: 200000, canceled: false, sealVersion: "", issuedBy: "u5", issuedAt: now },
  { id: "dc2", no: "S-2026-0007", type: "statement", title: "거래명세서", date: d(-3), partnerId: "pa2", partnerName: "한빛정형외과의원", sources: [{ kind: "txn", id: "tx3", date: d(-3), no: "T-2026-00009" }], total: 170000, canceled: false, sealVersion: "", issuedBy: "u5", issuedAt: now },
  { id: "dc3", no: "B-2026-0002", type: "invoice", title: "청구서", date: d(-1), partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", sources: [], total: 1320000, canceled: false, sealVersion: "", issuedBy: "mock-host", issuedAt: now },
  { id: "dc4", no: "S-2026-0006", type: "statement", title: "거래명세서", date: d(-6), partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", sources: [{ kind: "txn", id: "tx6", date: d(-6), no: "T-2026-00006" }], total: 120000, canceled: true, sealVersion: "", issuedBy: "u5", issuedAt: now },
  { id: "dc5", no: "W-2026-0004", type: "work", title: "작업 확인서", date: d(-2), partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", sources: [{ kind: "service", id: "sv2", no: "AS-2026-0011" }], total: 0, canceled: false, sealVersion: "", issuedBy: "u6", issuedAt: now },
];

// 행컴퍼니 C3 거래
const cpTxns = [
  { id: "tx1", no: "T-2026-00012", type: "rental_out", date: T, status: "confirmed", partnerId: "pa1", partnerName: "서울중앙초등학교", lines: [{ name: "설치비", qty: 1, unitPrice: 50000, vatMode: "excluded", supply: 50000, vat: 5000, total: 55000, manual: false, memo: "" }], supply: 50000, vat: 5000, total: 55000, paid: 0, paidBy: [], assetIds: ["as1"], assetCodes: ["A-000001"], assetNames: ["신도리코 D420 컬러복합기"], memo: "", createdBy: "u6", createdAt: now },
  { id: "tx2", no: "T-2026-00011", type: "receipt", date: T, status: "confirmed", partnerId: "pa2", partnerName: "한빛정형외과의원", accountId: "ac1", accountName: "국민 주거래", lines: [], amount: 200000, allocated: 150000, unallocated: 50000, allocations: [{ txnId: "tx3", date: d(-3), amount: 150000, no: "T-2026-00009" }], memo: "", createdBy: "u5", createdAt: now },
  { id: "tx3", no: "T-2026-00009", type: "sale", date: d(-3), status: "confirmed", partnerId: "pa2", partnerName: "한빛정형외과의원", lines: [{ itemId: "it4", name: "D420 토너 검정", unit: "개", qty: 2, unitPrice: 85000, vatMode: "included", supply: 154545, vat: 15455, total: 170000, manual: false, memo: "" }], supply: 154545, vat: 15455, total: 170000, paid: 150000, paidBy: [{ txnId: "tx2", date: T, amount: 150000 }], memo: "", createdBy: "u5", createdAt: now },
  { id: "tx4", no: "T-2026-00008", type: "purchase", date: d(-4), status: "confirmed", partnerId: "pa4", partnerName: "(주)대한오피스솔루션", lines: [{ itemId: "it1", name: "신도리코 D420 컬러복합기", unit: "대", qty: 2, unitPrice: 3200000, vatMode: "excluded", supply: 6400000, vat: 640000, total: 7040000, manual: false, memo: "", assetIds: ["as7", "as8"] }], supply: 6400000, vat: 640000, total: 7040000, paid: 3540000, paidBy: [], memo: "", createdBy: "mock-host", createdAt: now },
  { id: "tx5", no: "T-2026-00007", type: "expense", date: d(-5), status: "confirmed", accountId: "ac2", accountName: "현금 시재", lines: [], amount: 65000, category: "유류비", memo: "배송 차량 주유", createdBy: "u6", createdAt: now },
  { id: "tx6", no: "T-2026-00006", type: "charge", date: d(-6), status: "canceled", partnerId: "pa3", partnerName: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", lines: [{ name: "9월 임대료 (아주 긴 설명이 붙은 청구 내역 테스트)", qty: 1, unitPrice: 120000, vatMode: "included", supply: 109091, vat: 10909, total: 120000, manual: false, memo: "" }], supply: 109091, vat: 10909, total: 120000, paid: 0, paidBy: [], memo: "", canceledAt: now, cancelReason: "중복 입력", createdBy: "u5", createdAt: now },
];


type Handler = (q: URLSearchParams, parts: string[]) => unknown;
const GET: [RegExp, Handler][] = [
  [/^\/me$/, () => me],
  [/^\/settings$/, () => ({ theme: "system", goalKcal: 2000, goalCarb: 250, goalProtein: 120, goalFat: 60, goalWeight: 70, navTabs: ["todo", "calendar"] })],
  [/^\/layout$/, () => ({ layout: null, updatedAt: null })],
  [/^\/todos$/, (q) => ({ todos: q.get("status") === "done" ? [{ ...todos[0], id: "td", title: "끝낸 일", done: true, doneAt: now }] : todos })],
  [/^\/todos\/due$/, () => ({ todos: todos.filter((t) => t.due), projected: [{ todoId: "t4", title: "매주 분리수거", due: d(9), priority: "low" }] })],
  [/^\/todo-lists$/, () => ({ lists: [{ id: "l1", name: "회사", order: 1 }, { id: "l2", name: "집안일", order: 2 }] })],
  [/^\/events(\/search)?$/, () => ({ events })],
  [/^\/meals$/, () => ({ meals, totals })],
  [/^\/meals\/stats$/, () => ({ totals: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [d(-i), { kcal: 1500 + i * 120, carb: 200, protein: 80, fat: 50 }])) })],
  [/^\/foods$/, () => ({ foods: [{ id: "f1", name: "닭가슴살", basis: "100g", kcal: 109, carb: 0, protein: 23, fat: 1 }] })],
  [/^\/meal-sets$/, () => ({ sets: [{ id: "ms1", name: "아침 기본", items: [meals[0]] }] })],
  [/^\/ai\/usage$/, () => ({ used: 3, limit: 50 })],
  [/^\/weights$/, () => ({ weights })],
  [/^\/runs$/, () => ({ runs })],
  [/^\/runs\/records$/, () => ({ best5k: runs[0], best10k: runs[1] })],
  [/^\/gym$/, () => ({ sessions: gym })],
  [/^\/gym\/last$/, () => ({ last: { 벤치프레스: { date: d(-2), sets: gym[0]!.exercises[0]!.sets } } })],
  [/^\/gym\/progress$/, () => ({ points: [{ date: d(-9), maxWeight: 60, volume: 1200 }, { date: d(-2), maxWeight: 65, volume: 1400 }] })],
  [/^\/routines$/, () => ({ routines: [{ id: "rt1", name: "상체 A", exercises: [{ name: "벤치프레스", sets: 3 }, { name: "랫풀다운", sets: 3 }] }] })],
  [/^\/programs$/, () => ({ programs: [program] })],
  [/^\/notes$/, (q) => ({ notes: q.get("trash") === "true" ? [{ ...notes[2], id: "nt", deletedAt: now }] : notes })],
  [/^\/notes\/[^/]+$/, (_q, p) => notes.find((n) => n.id === p[1]) ?? notes[0]],
  [/^\/txns$/, () => ({ txns })],
  [/^\/txns\/summary$/, () => ({ months: Array.from({ length: 6 }, (_, i) => ({ month: `${M.slice(0, 4)}-${String(Math.max(1, Number(M.slice(5)) - 5 + i)).padStart(2, "0")}`, income: 3500000, expense: 1400000 + i * 90000 })), methods: ["카드", "현금", "계좌이체"] })],
  [/^\/txns\/search$/, () => ({ txns })],
  [/^\/categories$/, () => ({ categories })],
  [/^\/budgets\/[^/]+$/, (_q, p) => ({ month: p[1], from: M, amounts: { ce0: 400000, ce1: 10000, ce3: 1250000 } })],
  [/^\/recurring$/, () => ({ recurring: [{ id: "rc1", type: "expense", amount: 1250000, categoryId: "ce3", method: "계좌이체", memo: "월세", day: 31, startMonth: M }] })],
  [/^\/hub$/, () => ({ items: hubItems })],
  [/^\/hub\/collections$/, () => ({ collections: [{ id: "hc1", name: "AWS", order: 1 }, { id: "hc2", name: "Git", order: 2 }] })],
  [/^\/boards$/, () => ({
    boards: [
      { id: "b1", name: "사이드 프로젝트", ownerSub: "mock-host", labels, createdAt: now, role: "owner", favorite: true, progress: { done: 1, total: 4 }, memberCount: 3, activeCount: 3 },
      { id: "b2", name: LONG, ownerSub: "u2", labels: [], createdAt: now, role: "viewer", favorite: false, progress: { done: 0, total: 0 }, memberCount: 2, activeCount: 0 },
    ],
    myCards: [{ id: "k1", title: "로그인 화면 디자인", due: d(1), priority: "normal", boardId: "b1", boardName: "사이드 프로젝트", columnName: "할 일" }],
  })],
  [/^\/boards\/templates$/, () => ({ templates: [{ id: "bt1", name: "개발", columns: boardCols, labels, createdAt: now }] })],
  [/^\/boards\/[^/]+$/, () => ({ board: { id: "b1", name: "사이드 프로젝트", ownerSub: "mock-host", labels, createdAt: now }, role: "owner", favorite: true, columns: boardCols, cards, archivedCount: 2, members, progress: { done: 1, total: 4 } })],
  [/^\/boards\/[^/]+\/activity$/, () => ({ activity: [{ actor: "u2", cardId: "k3", cardTitle: "API 연결", action: "moved", at: now, from: "할 일", to: "진행 중" }, { actor: "mock-host", cardId: "k2", cardTitle: LONG, action: "created", at: now, to: "할 일" }] })],
  [/^\/boards\/[^/]+\/archived$/, () => ({ cards: [{ ...cards[3], id: "ka", archived: true, archivedAt: now }] })],
  [/^\/boards\/[^/]+\/candidates$/, () => ({ candidates: [{ sub: "u4", name: "새 멤버", email: "new@example.com" }] })],
  [/^\/boards\/[^/]+\/cards\/[^/]+\/comments$/, () => ({ comments: [{ id: "cm1", author: "u2", text: "확인했어요. 내일까지 마무리할게요!", createdAt: now }] })],
  [/^\/checklists$/, () => ({ lists })],
  [/^\/checklists\/templates$/, () => ({ templates: [{ id: "lt1", name: "여행 준비물", icon: "🧳", items: ["여권", "충전기"], createdAt: now }] })],
  [/^\/checklists\/[^/]+$/, () => ({ list: lists[0], role: "owner", favorite: true, items: listItems, members })],
  [/^\/checklists\/[^/]+\/candidates$/, () => ({ candidates: [{ sub: "u4", name: "새 멤버", email: "new@example.com" }] })],
  [/^\/admin\/users$/, (q) => ({ users: q.get("status") ? adminUsers.filter((u) => u.status === q.get("status")) : adminUsers })],
  [/^\/admin\/permissions$/, () => ({ users: adminUsers.map((u) => ({ ...u, perms: allEdit })) })],
  [/^\/admin\/presets$/, () => ({ presets: [{ id: "family", name: "가족", perms: allEdit }, { id: "team", name: "팀", perms: allEdit }] })],
  [/^\/admin\/audit$/, () => ({ logs: [{ at: now, action: "approve", actor: "mock-host", actorEmail: "host@example.com", target: "u2", detail: { presetId: "family" } }] })],
  [/^\/company$/, () => ({ companies: [{ id: "cp1", name: "행컴퍼니", isAdmin: true }] })],
  [/^\/company\/[^/]+$/, () => ({ company: companyInfo, me: { isAdmin: true, perms: allAreas("edit"), showAmounts: true }, areas: AREA_IDS })],
  [/^\/company\/[^/]+\/roles$/, () => ({ roles: companyRoles })],
  [/^\/company\/[^/]+\/members$/, () => ({
    members: [
      { sub: "mock-host", name: "이현행", email: "host@example.com", roleId: "admin", isAdmin: true, showAmounts: true, perms: allAreas("edit"), joinedAt: now },
      { sub: "u5", name: "김경리", email: "account@example.com", roleId: "accountant", isAdmin: false, showAmounts: true, perms: companyRoles[1]!.perms, joinedAt: now },
      { sub: "u6", name: "박기사 (현장 아주 긴 이름 테스트)", email: "field-engineer-long-address@example.com", roleId: "field", isAdmin: false, showAmounts: false, perms: companyRoles[3]!.perms, joinedAt: now },
    ],
  })],
  [/^\/company\/[^/]+\/invites$/, () => ({ invites: [{ code: "abcDEF123456", cid: "cp1", companyName: "행컴퍼니", roleId: "field", roleName: "현장 기사", note: "신입 기사", createdAt: now, expiresAt: Math.floor(Date.now() / 1000) + 6 * 86400 }] })],
  [/^\/company\/[^/]+\/audit$/, () => ({
    logs: [
      { at: now, actor: "mock-host", actorName: "이현행", action: "member_change", target: "u6", targetName: "박기사", detail: { showAmounts: "True→False" } },
      { at: now, actor: "u6", actorName: "박기사", action: "invite_accept", target: "u6", targetName: "박기사", detail: { role: "현장 기사", note: "신입 기사" } },
      { at: now, actor: "mock-host", actorName: "이현행", action: "company_create", target: "", detail: { name: "행컴퍼니" } },
    ],
  })],
  [/^\/invite\/[^/]+$/, () => ({ companyName: "행컴퍼니", roleName: "현장 기사", expiresAt: Math.floor(Date.now() / 1000) + 6 * 86400 })],
  [/^\/company\/[^/]+\/partners$/, () => ({ partners: cpPartners })],
  [/^\/company\/[^/]+\/partners\/[^/]+$/, (_q, p) => ({ partner: cpPartners.find((x) => x.id === p[3]) ?? cpPartners[0], assets: cpAssets.filter((a) => a.partnerId === p[3]) })],
  [/^\/company\/[^/]+\/items$/, () => ({ items: cpItems })],
  [/^\/company\/[^/]+\/assets$/, () => ({ assets: cpAssets })],
  [/^\/company\/[^/]+\/assets\/[^/]+$/, (_q, p) => ({
    asset: cpAssets.find((x) => x.id === p[3]) ?? cpAssets[0],
    logs: [
      { at: now, actor: "u6", action: "status", from: "rented", to: "repair" },
      { at: now, actor: "mock-host", action: "registered", note: "기초 등록" },
    ],
  })],
  [/^\/company\/[^/]+\/accounts$/, () => ({ accounts: cpAccounts })],
  [/^\/company\/[^/]+\/txns$/, () => ({ txns: cpTxns })],
  [/^\/company\/[^/]+\/txns\/[^/]+\/[^/]+$/, (_q, p) => ({ txn: cpTxns.find((t) => t.id === p[4]) ?? cpTxns[0] })],
  [/^\/company\/[^/]+\/open-charges$/, () => ({ charges: [{ id: "tx3", no: "T-2026-00009", date: d(-3), type: "sale", total: 170000, paid: 150000, open: 20000, summary: "D420 토너 검정" }, { id: "tx1", no: "T-2026-00012", date: T, type: "rental_out", total: 55000, paid: 0, open: 55000, summary: "설치비" }] })],
  [/^\/company\/[^/]+\/receivables$/, () => ({ partners: cpPartners.filter((p) => p.receivable || p.advance || p.payable).map((p) => ({ id: p.id, name: p.name, kind: p.kind, receivable: p.receivable, advance: p.advance, payable: p.payable, prepaid: 0 })) })],
  [/^\/company\/[^/]+\/ledger$/, () => ({
    rows: [
      { date: T, id: "tx2", no: "T-2026-00011", type: "receipt", accountId: "ac1", accountName: "국민 주거래", partnerName: "한빛정형외과의원", category: "", memo: "", amount: 200000, balanceAfter: 15840000 },
      { date: d(-5), id: "tx5", no: "T-2026-00007", type: "expense", accountId: "ac2", accountName: "현금 시재", partnerName: "", category: "유류비", memo: "배송 차량 주유", amount: -65000, balanceAfter: 185000 },
    ],
    accounts: cpAccounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance })),
  })],
  [/^\/company\/[^/]+\/closes$/, () => ({ closes: [{ month: "2026-08", closedAt: now }] })],
  [/^\/company\/[^/]+\/contracts$/, (q) => ({ contracts: cpContracts.filter((c) => (!q.get("partnerId") || c.partnerId === q.get("partnerId")) && (!q.get("status") || c.status === q.get("status"))) })],
  [/^\/company\/[^/]+\/contracts\/[^/]+$/, (_q, p) => {
    const c = cpContracts.find((x) => x.id === p[3]) ?? cpContracts[0]!;
    return { contract: c, txns: cpTxns.filter((t) => t.partnerId === c.partnerId), pending: pendingBills.find((b) => b.contractId === c.id) ?? null };
  }],
  [/^\/company\/[^/]+\/billing$/, () => ({ pending: pendingBills })],
  [/^\/company\/[^/]+\/readings$/, () => ({ rows: readingRows })],
  [/^\/company\/[^/]+\/services$/, (q) => ({ services: cpServices.filter((x) => (!q.get("status") || x.status === q.get("status")) && (!q.get("partnerId") || x.partnerId === q.get("partnerId"))) })],
  [/^\/company\/[^/]+\/services\/[^/]+$/, (_q, p) => ({ service: cpServices.find((x) => x.id === p[3]) ?? cpServices[0], txn: null })],
  [/^\/company\/[^/]+\/staff$/, () => ({ staff: [{ sub: "mock-host", name: "이현행" }, { sub: "u5", name: "김경리" }, { sub: "u6", name: "박기사" }] })],
  [/^\/company\/[^/]+\/docs$/, (q) => ({ docs: cpDocs.filter((x) => (!q.get("source") || x.sources.some((s) => s.id === q.get("source"))) && (!q.get("partnerId") || x.partnerId === q.get("partnerId"))) })],
  [/^\/company\/[^/]+\/docs\/[^/]+\/pdf$/, (_q, p) => ({ filename: `문서_${p[3]}.pdf`, contentType: "application/pdf", data: "JVBERi0xLjQK", url: "about:blank", no: cpDocs.find((x) => x.id === p[3])?.no, canceled: cpDocs.find((x) => x.id === p[3])?.canceled })],
  [/^\/company\/[^/]+\/seal$/, () => ({ data: null })],
  [/^\/company\/[^/]+\/notifications$/, () => ({
    unread: 2,
    notifications: [
      { type: "service_assigned", title: "내게 A/S 배정 AS-2026-0012", body: "서울중앙초등학교 · A-000001 · 용지 걸림이 하루에도 여러 번, 2단 카세트에서 소리가 남", url: "/company/cp1/services/sv1", at: now, unread: true },
      { type: "overdue", title: "새로 연체된 미수 2건", body: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소 외 1곳 · 1,320,000원", url: "/company/cp1/money", at: now, unread: true },
      { type: "stock_low", title: "재고 부족: D420 토너 검정", body: "T-2026-00009 이후 최소 재고보다 적습니다", url: "/company/cp1/items", at: now, unread: false },
    ],
  })],
  [/^\/company\/[^/]+\/notify\/settings$/, () => ({
    publicKey: "BOrUfOcdUj5TB7pHUD2ZRqtn5C8kByqbhJjOdx0nqY9p8jmKjqQ3KXRSzv6dyuCK0oa0iLu6v2kwJX5n6KTfNzM",
    devices: 1,
    types: [
      { id: "service_assigned", label: "내게 A/S 배정", group: "instant", on: true },
      { id: "service_new", label: "A/S 접수", group: "instant", on: false },
      { id: "service_done", label: "A/S 완료", group: "instant", on: false },
      { id: "receipt_new", label: "입금 들어옴", group: "instant", on: true },
      { id: "stock_low", label: "재고 부족으로 떨어짐", group: "instant", on: true },
      { id: "rental", label: "임대 출고·수거", group: "instant", on: false },
      { id: "overdue", label: "새로 연체된 미수", group: "daily", on: true },
      { id: "contract_expiring", label: "계약 만료 30일 전", group: "daily", on: true },
      { id: "billing_due", label: "새 청구 대기", group: "daily", on: true },
      { id: "readings_due", label: "검침 필요", group: "daily", on: false },
      { id: "service_stale", label: "3일 넘게 안 끝난 A/S", group: "daily", on: true },
    ],
  })],
  [/^\/company\/[^/]+\/dashboard$/, () => ({
    month: T.slice(0, 7),
    money: { this: { salesTotal: 4180000, receipts: 3250000, purchaseTotal: 7040000, expenses: 1388000 }, last: { salesTotal: 3920000, receipts: 3600000, purchaseTotal: 0, expenses: 1420000 } },
    receivables: { total: 1560000, partners: 3, overdueDays: 30, top: [
      { id: "pa3", name: "법무법인 정의와 공정 아주 긴 이름 서초 분사무소", receivable: 1320000, overdue: 680000 },
      { id: "pa1", name: "서울중앙초등학교", receivable: 240000, overdue: 0 },
    ] },
    lowStock: [{ id: "it4", name: "D420 토너 검정", qty: 3, minStock: 5, unit: "개" }, { id: "it8", name: "D420 정착기 유닛 (아주 긴 부품 이름 테스트)", qty: 0, minStock: 1, unit: "개" }],
    expiring: [{ id: "k1", no: "C-2026-0001", partnerName: "서울중앙초등학교", termEnd: d(20) }],
    assets: { rented: 3, in_stock: 1, repair: 1 },
  })],
  [/^\/company\/[^/]+\/reports$/, () => ({
    from: "2026-05", to: T.slice(0, 7),
    monthly: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m, i) => ({ month: m, salesSupply: 2400000 + i * 310000, salesVat: 240000 + i * 31000, salesTotal: 2640000 + i * 341000, receipts: 2100000 + i * 280000, purchaseSupply: i === 3 ? 6400000 : 400000, purchaseTotal: i === 3 ? 7040000 : 440000, payments: 500000, expenses: 1300000 + i * 20000 })),
    partners: cpPartners.map((p, i) => ({ id: p.id, name: p.name, salesTotal: 1200000 - i * 150000, receipts: 900000 - i * 100000, purchaseTotal: p.kind === "supplier" ? 7040000 : 0, payments: 0, receivable: p.receivable, payable: p.payable })),
    items: cpItems.filter((i) => i.tracking === "stock").map((i, k) => ({ id: i.id, name: i.name, unit: i.unit, saleQty: 12 - k, saleSupply: 980000 - k * 90000, usedQty: k % 2, purchaseQty: 20 - k, purchaseSupply: 600000 - k * 50000 })),
    expenses: [{ category: "임차료", amount: 3600000 }, { category: "인건비", amount: 2800000 }, { category: "유류비", amount: 195000 }],
    assets: [{ id: "it1", name: "신도리코 D420 컬러복합기", total: 8, rented: 5, in_stock: 2, repair: 1 }, { id: "it2", name: "캐논 iR2630 흑백복합기", total: 4, rented: 3, in_stock: 1, repair: 0 }],
  })],
  [/^\/health$/, () => ({ status: "ok", service: "mock" })],
];

export async function mockFetch<T>(path: string, method: string, body: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 50));
  const url = new URL(path, "http://mock");
  const parts = url.pathname.split("/").filter(Boolean);
  if (method === "GET") {
    const hit = GET.find(([re]) => re.test(url.pathname));
    if (!hit) throw new Error(`mock: no GET ${url.pathname}`);
    return structuredClone(hit[1](url.searchParams, parts)) as T;
  }
  if (method === "DELETE") return { deleted: parts.at(-1) } as T;
  if (url.pathname === "/recurring/apply") return { created: [] } as T;
  return { id: `new-${Date.now()}`, createdAt: now, updatedAt: now, ...(body as object) } as T;
}
