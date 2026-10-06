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
