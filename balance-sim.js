/* 눈알이 빠지도록 — 밸런스 시뮬레이터
   게임 본체(gyeoljae-tycoon.html)의 상수·수식·배치 기하를 그대로 옮겨 헤드리스로 돌린다. */

// ── 게임 상수 (본체와 일치) ─────────────────────────
const DAY_LEN = 92;
const SETTLE_PAUSE = 5;                 // 정산 모달을 읽는 시간(초) — 실제 플레이 시간에 포함
const STAMP_LOCK = 0.92;                // 도장 애니메이션 동안 다음 서류를 못 봄 (530ms+390ms)
const RENT = [0, 900, 2200, 4500];
const SALARY = 1200;   // + (교육Lv-1)*260
const ROOM = [
  {cols:2, rows:2, cap:3,  cost:0},
  {cols:3, rows:2, cap:6,  cost:13000},
  {cols:3, rows:3, cap:9,  cost:42000},
  {cols:4, rows:3, cap:12, cost:120000},
];
const WALL=0.55, DESK_W=1.7, COL_P=2.15, ROW_P=2.45, WALK_SPD=2.3;
const DOC_MULT = {expense:1.00, leave:0.95, purchase:1.35, contract:1.75};
const DOC_DAY  = {expense:1, leave:1, purchase:3, contract:6};
const RANK_TIERS = [[0,"구멍가게 사무실"],[6,"작지만 단단한 사무소"],[11,"성장 중인 스타트업"],
                    [16,"알찬 중소기업"],[22,"튼튼한 중견기업"],[28,"사옥을 가진 회사"]];
const COST = {
  desk:  l => Math.round(1400*Math.pow(1.45,l-3)),
  hire:  l => Math.round(2300*Math.pow(1.42,l-1)),
  office:l => ROOM[l] ? ROOM[l].cost : Infinity,
  computer:l => [3200,7500,16000,34000][l-1] ?? Infinity,
  chair: l => [2600,6200,14500][l-1] ?? Infinity,
  tray:  l => [2000,5000,11500][l-1] ?? Infinity,
  coffee:l => [3000,7200,16500][l-1] ?? Infinity,
  interior:l => [1800,4600,10500][l-1] ?? Infinity,
  train:l => [3000,7000,15000,32000][l-1] ?? Infinity,
};
const MAXLV = {desk:12, hire:12, office:4, computer:5, chair:4, tray:4, coffee:4, interior:4, train:5};
/* 직원 교육: 자체 처리 비율 / 자체 처리 수수료율 */
const PRE_RATE = [0, 0.22, 0.38, 0.55, 0.70];
const PRE_FEE  = [0, 0.26, 0.31, 0.36, 0.40];

// ── 배치 기하 (본체 geo()와 동일) ───────────────────
function geo(officeLv){
  const r = ROOM[officeLv-1];
  const x0 = WALL+0.4, y0 = WALL+0.95;
  const lastRight = x0 + (r.cols-1)*COL_P + DESK_W;
  const trunkX = lastRight + 0.85;
  const bottomY = y0 + r.rows*ROW_P;
  const bossX = trunkX + 0.7, bossY = bottomY + 0.95;
  return {...r, x0, y0, trunkX, bossX, bossY, dropX: bossX-0.5, dropY: bossY+0.62};
}
/* 직원 slot 의 왕복 통로 거리(타일) — 책상→가로통로→세로통로→결재함 */
function roundTrip(officeLv, slot){
  const g = geo(officeLv);
  const row = Math.floor(slot/g.cols), col = slot%g.cols;
  const homeX = g.x0 + col*COL_P + DESK_W/2;
  const homeY = g.y0 + row*ROW_P + 0.78 - 0.42;
  const ay = g.y0 + row*ROW_P;
  const d = Math.abs(homeY-ay) + Math.abs(g.trunkX-homeX)
          + Math.abs(g.dropY-ay) + Math.abs(g.dropX-g.trunkX);
  return d*2/WALK_SPD;                      // 왕복 초
}

// ── 플레이어 모델 ───────────────────────────────────
/* t0        : 규정 3개일 때 서류 1건을 읽고 판단하는 시간(초)
   m0        : 규정 3개일 때 오결재 확률
   reasonAcc : 반려 시 정확한 사유를 고를 확률
   규정이 늘수록 느려지고 틀리기 쉬워진다. 컴퓨터가 위반을 자동 검출하면 빨라지고 정확해진다. */
const PROFILES = {
  "초보":  {t0:9.5, m0:0.14,  reasonAcc:0.60},
  "보통":  {t0:6.5, m0:0.07,  reasonAcc:0.80},
  "숙련":  {t0:4.2, m0:0.025, reasonAcc:0.93},
};

const rnd = () => Math.random();
const ri  = (a,b) => a + Math.floor(Math.random()*(b-a+1));

function rulesOn(day){ return Math.min(10, 2+day); }
function docTypes(day){ return Object.keys(DOC_DAY).filter(k=>DOC_DAY[k]<=day); }

/* 컴퓨터 보조가 위반을 자동 검출할 확률 (본체 applyAssist 근사)
   lv3: sum/days, lv4: +empid/biz, lv5: 남은 것 중 1건 — 해금된 규정 구성에 따라 대략적 커버리지 */
function assistCover(lv, day){
  if(lv<2) return 0;
  const R = rulesOn(day);
  let auto = 0;
  if(lv>=3) auto += (day>=4?1:0) + (day>=6?1:0);        // sum, days
  if(lv>=4) auto += 2;                                   // empid, biz(day5+)
  let p = Math.min(0.85, auto/R);
  if(lv>=5) p = Math.min(0.95, p + (1-p)*0.9);           // 남은 위반 1건 추가 검출
  if(lv>=2) p = Math.min(0.95, p + (1-p)*0.35);          // 🔍 확인 표시
  return p;
}

// ── 한 판 시뮬레이션 ────────────────────────────────
function runGame(prof, policy, maxRealSec, marks){
  const P = PROFILES[prof];
  const S = {money:START_MONEY, rep:70, day:1, desks:3, officeLv:1,
             computerLv:1, chairLv:1, trayLv:1, coffeeLv:1, interiorLv:1, trainLv:1,
             emps:[{slot:0}], dead:null, deadAt:null};
  let realT = 0;
  const snaps = {};
  const stat = {docs:0, ok:0, miss:0, overflow:0, waiting:0, busy:0, idle:0, supplied:0, selfDone:0, selfIncome:0, inboxSum:0, inboxN:0};

  const takeSnap = (t) => {
    const sc = S.officeLv*3 + S.emps.length + S.computerLv + (S.trainLv-1);
    let rank = RANK_TIERS[0][1];
    for(const [m,nm] of RANK_TIERS) if(sc>=m) rank=nm;
    snaps[t] = {money:S.money, rep:S.rep, day:S.day, emps:S.emps.length, desks:S.desks,
                officeLv:S.officeLv, computerLv:S.computerLv, trayLv:S.trayLv,
                trainLv:S.trainLv, rank, dead:!!S.dead, deadWhy:S.dead};
  };
  let nextMark = 0;

  while(realT < maxRealSec && !S.dead){
    // ─── 하루 ───
    const trayCap = 3 + S.trayLv*2;
    const prod = 1 + 0.18*(S.coffeeLv-1);
    const R = rulesOn(S.day);
    const types = docTypes(S.day);
    const cover = assistCover(S.computerLv, S.day);
    const reviewT = (P.t0 + 0.42*(R-3));
    const missBase = P.m0 * (1 + 0.075*(R-3));

    // 직원별 타이머 (작업시간 + 왕복 이동)
    const emp = S.emps.map(e=>({
      slot:e.slot,
      half: roundTrip(S.officeLv, e.slot)/2,     // 편도
      st:"work", t:(3 + rnd()*6)/prod,
    }));
    let clock = 0, inbox = 0, busyUntil = -1, curBad = 0, curType = null;
    const today = {ok:0, miss:0, income:0, docs:0};
    const dt = 0.1;

    while(clock < DAY_LEN){
      clock += dt; realT += dt;
      if(realT >= marks[nextMark]){ takeSnap(marks[nextMark]); nextMark++;
        if(nextMark >= marks.length) { /* 계속 진행 */ } }

      // 직원 상태 기계
      for(const e of emp){
        if(e.st==="wait"){                       // 결재함이 빌 때까지 줄 서서 대기
          stat.waiting += dt;
          if(inbox < trayCap){ inbox++; e.st="back"; e.t=e.half; }
          continue;
        }
        e.t -= dt*(e.st==="work"?prod:1);
        if(e.t > 0) continue;
        if(e.st==="work"){
          stat.supplied++;
          const work = (11 + rnd()*5)/prod;
          if(rnd() < PRE_RATE[S.trainLv-1]){
            const type = types[Math.floor(rnd()*types.length)];
            const repMult = 0.82 + S.rep/280;
            const base = Math.round(700*DOC_MULT[type]*(1+0.045*(S.day-1))*repMult/10)*10;
            const amt = Math.round(base*PRE_FEE[S.trainLv-1]/10)*10;
            S.money += amt; today.income += amt;
            stat.selfDone++; stat.selfIncome += amt;
            e.t = work;                          // 자리에서 처리, 이동 없음
          } else { e.st="toTray"; e.t=e.half; }
        } else if(e.st==="toTray"){
          if(inbox < trayCap){ inbox++; e.st="back"; e.t=e.half; }
          else { e.st="wait"; stat.overflow++; }
        } else if(e.st==="back"){
          e.st="work"; e.t=(11 + rnd()*5)/prod;
        }
      }
      if(S.dead) break;
      stat.inboxSum += inbox; stat.inboxN++;

      // 플레이어
      if(busyUntil > 0){ busyUntil -= dt; stat.busy += dt; }
      else if(inbox > 0){
        inbox--;
        // 서류 생성
        const type = types[Math.floor(rnd()*types.length)];
        const roll = rnd();
        let nv = 0;
        if(roll < 0.46) nv = 1;
        if(S.day>=5 && roll > 0.88) nv = 2;
        const bad = nv > 0;
        // 보조 검출 여부
        const detected = bad && rnd() < cover;
        const t = reviewT * (detected ? 0.55 : 1);
        let miss = missBase * (detected ? 0.12 : 1);
        if(nv===2) miss *= 0.7;                     // 위반 2건이면 하나라도 걸릴 확률↑
        const wrong = rnd() < miss;
        const repMult = 0.82 + S.rep/280;
        const reward = Math.round(700*DOC_MULT[type]*(1+0.12*(S.chairLv-1))
                        *(1+0.045*(S.day-1))*repMult/10)*10;
        if(!wrong){
          let amt = reward;
          if(bad && (detected || rnd()<P.reasonAcc)) amt = Math.round(amt*1.4/10)*10;
          S.money += amt; S.rep = Math.min(100,S.rep+1);
          today.ok++; today.income += amt; stat.ok++;
        } else {
          const fine = Math.round(reward*FINE_X/10)*10;
          S.money -= fine; S.rep = Math.max(0,S.rep-MISS_REP);
          today.miss++; today.income -= fine; stat.miss++;
          if(S.rep<=0){ S.dead="신뢰도 0"; S.deadAt=realT; break; }
        }
        today.docs++; stat.docs++;
        busyUntil = t + STAMP_LOCK;
        stat.busy += dt;
      } else stat.idle += dt;
    }
    if(S.dead) break;

    // ─── 정산 ───
    const salary = S.emps.length*(SALARY + (S.trainLv-1)*260), rent = RENT[S.officeLv-1];
    const upkeep = Math.round((S.computerLv-1)*120 + (S.coffeeLv-1)*180);
    S.money -= salary + rent + upkeep;
    S.rep = Math.min(100, S.rep + (S.interiorLv-1)*2);
    if(S.money < 0){ S.dead="자금 마이너스(파산)"; S.deadAt=realT; break; }
    realT += SETTLE_PAUSE;
    if(nextMark<marks.length && realT>=marks[nextMark]){ takeSnap(marks[nextMark]); nextMark++; }

    // ─── 업그레이드 구매 ───
    policy(S, {trayCap, reviewT, prodDay:today});
    S.day++;
  }
  while(nextMark < marks.length){ takeSnap(marks[nextMark]); nextMark++; }
  return {snaps, stat, dead:S.dead, deadAt:S.deadAt};
}

// ── 구매 정책 ───────────────────────────────────────
const lvOf = (S,id)=>({desk:S.desks,hire:S.emps.length,office:S.officeLv,computer:S.computerLv,
                       chair:S.chairLv,tray:S.trayLv,coffee:S.coffeeLv,interior:S.interiorLv,
                       train:S.trainLv}[id]);
function canBuy(S,id){
  const lv = lvOf(S,id);
  if(lv >= MAXLV[id]) return false;
  if(id==="desk" && S.desks >= ROOM[S.officeLv-1].cap) return false;
  if(id==="hire" && S.emps.length >= S.desks) return false;
  return S.money >= COST[id](lv);
}
function doBuy(S,id){
  const lv = lvOf(S,id);
  S.money -= COST[id](lv);
  if(id==="desk") S.desks++;
  else if(id==="hire") S.emps.push({slot: nextSlot(S)});
  else if(id==="office") S.officeLv++;
  else if(id==="computer") S.computerLv++;
  else if(id==="chair") S.chairLv++;
  else if(id==="tray") S.trayLv++;
  else if(id==="coffee") S.coffeeLv++;
  else if(id==="interior") S.interiorLv++;
  else if(id==="train") S.trainLv++;
}
function nextSlot(S){
  const used = new Set(S.emps.map(e=>e.slot));
  let i=0; while(used.has(i)) i++;
  return i;
}
/* 1) 순진한 확장 — 사람을 최대한 빨리 늘린다 */
function policyNaive(S){
  let guard=0;
  while(guard++ < 30){
    const order = ["hire","desk","office","computer","chair","tray","coffee","train","interior"];
    const pick = order.find(id=>canBuy(S,id));
    if(!pick) break;
    doBuy(S,pick);
  }
}
/* 2) 균형 — 처리 능력에 맞춰 사람을 늘리고, 보조 장비를 먼저 산다 */
function policyBalanced(S, ctx){
  const reserve = S.emps.length*SALARY + RENT[S.officeLv-1] + 1500;   // 하루치 고정비 + 여유
  let guard=0;
  while(guard++ < 30){
    // 내 처리 능력(건/일) 대비 공급량 추정
    const cov = assistCover(S.computerLv, S.day);
    const perDoc = ctx.reviewT*(1 - cov*0.46*0.45) + STAMP_LOCK;   // 검출된 건은 0.55배
    const myCap = DAY_LEN/perDoc;
    const trip = roundTrip(S.officeLv, 0);
    const pre = PRE_RATE[S.trainLv-1];
    const cyc = (13.5/(1+0.18*(S.coffeeLv-1))) + trip*(1-pre);
    const supply = S.emps.length * DAY_LEN / cyc * (1-pre);   // 내게 오는 양
    const order = [];
    if(S.trayLv<4 && supply > myCap*0.8) order.push("tray");
    if(S.trainLv<5 && S.emps.length>=2) order.push("train");  // 확장의 열쇠
    if(S.computerLv<5) order.push("computer");
    if(S.chairLv<4) order.push("chair");
    // 자체 처리 수익(일당)이 급여+유지비를 넘으면 증원은 계속 이득
    const cycle = (13.5/(1+0.18*(S.coffeeLv-1))) + trip*(1-pre);
    const autoPay = DAY_LEN/cycle*pre*820*PRE_FEE[S.trainLv-1];
    const worthHiring = autoPay > SALARY + (S.trainLv-1)*260 + 250;
    if(supply < myCap*0.92 || worthHiring){
      if(S.emps.length < S.desks) order.push("hire");
      else if(S.desks < ROOM[S.officeLv-1].cap) order.push("desk");
      else order.push("office");
    }
    if(S.interiorLv<4) order.push("interior");
    const pick = order.find(id=>canBuy(S,id) && S.money - COST[id](lvOf(S,id)) >= reserve);
    if(!pick) break;
    doBuy(S,pick);
  }
}

// ── 실행 ────────────────────────────────────────────
const MARKS = [600, 1800, 3600, 7200];            // 10 / 30 / 60 / 120 분
const N = 400;
const START_MONEY = +(process.env.START||5000);
const FINE_X = +(process.env.FINE||1.3);
const MISS_REP = +(process.env.MREP||5);
const med = a => { const b=[...a].sort((x,y)=>x-y); return b[Math.floor(b.length/2)]; };
const avg = a => a.reduce((s,x)=>s+x,0)/a.length;
const fmt = n => "₩"+Math.round(n).toLocaleString("en-US");

function report(prof, policy, policyName){
  const runs = Array.from({length:N},()=>runGame(prof, policy, 7200, MARKS));
  console.log(`\n■ ${prof} 플레이어 · ${policyName}  (${N}회 시뮬레이션)`);
  console.log("  시간 | 생존율 | 자금(중앙) | 직원 | 책상 | 사무실 | 교육 | 컴퓨터 | 등급");
  console.log("  " + "-".repeat(92));
  for(const m of MARKS){
    const s = runs.map(r=>r.snaps[m]).filter(Boolean);
    const alive = s.filter(x=>!x.dead);
    const rate = alive.length/s.length*100;
    if(!alive.length){ console.log(`  ${(m/60+"분").padEnd(5)}| ${rate.toFixed(0).padStart(5)}% | 전멸`); continue; }
    const rankCount = {};
    alive.forEach(x=>rankCount[x.rank]=(rankCount[x.rank]||0)+1);
    const topRank = Object.entries(rankCount).sort((a,b)=>b[1]-a[1])[0][0];
    console.log(`  ${(m/60+"분").padEnd(5)}| ${rate.toFixed(0).padStart(5)}% | ${fmt(med(alive.map(x=>x.money))).padStart(10)} | `
      + `${med(alive.map(x=>x.emps)).toString().padStart(4)} | ${med(alive.map(x=>x.desks)).toString().padStart(4)} | `
      + `Lv${med(alive.map(x=>x.officeLv))}    | Lv${med(alive.map(x=>x.trainLv))}  | Lv${med(alive.map(x=>x.computerLv))}     | ${topRank}`);
  }
  const deaths = runs.filter(r=>r.dead);
  const why = {};
  deaths.forEach(r=>why[r.dead]=(why[r.dead]||0)+1);
  const st = runs.map(r=>r.stat);
  const totalDocs = avg(st.map(x=>x.docs)), totalSup = avg(st.map(x=>x.supplied));
  console.log(`  폐업 ${deaths.length}/${N} (${(deaths.length/N*100).toFixed(0)}%)`
    + (deaths.length?` — ${Object.entries(why).map(([k,v])=>`${k} ${v}건`).join(", ")}`:""));
  if(deaths.length) console.log(`  폐업 시점 중앙값: ${(med(deaths.map(r=>r.deadAt))/60).toFixed(0)}분`);
  console.log(`  공급 ${totalSup.toFixed(0)}건 = 내 결재 ${totalDocs.toFixed(0)}건 + 직원 자체 처리 ${avg(st.map(x=>x.selfDone)).toFixed(0)}건`
    + `,  대기열 발생 ${avg(st.map(x=>x.overflow)).toFixed(0)}회`);
  console.log(`  결재 대기 평균 ${avg(st.map(x=>x.inboxSum/Math.max(1,x.inboxN))).toFixed(2)}장`
    + `,  플레이어 가동률 ${(avg(st.map(x=>x.busy/(x.busy+x.idle)))*100).toFixed(0)}%`
    + `,  직원 줄서기 ${(avg(st.map(x=>x.waiting))/60).toFixed(1)}분`);
  return runs;
}

console.log("═".repeat(88));
console.log(" 눈알이 빠지도록 — 밸런스 시뮬레이션");
console.log(` 하루 ${DAY_LEN}초 + 정산 ${SETTLE_PAUSE}초 = ${DAY_LEN+SETTLE_PAUSE}초`
  + ` → 10분 ≈ ${(600/(DAY_LEN+SETTLE_PAUSE)).toFixed(1)}일, 120분 ≈ ${(7200/(DAY_LEN+SETTLE_PAUSE)).toFixed(0)}일`);
console.log("═".repeat(88));

// 공급 vs 처리 능력 기초 분석
console.log("\n[기초] 직원 1명이 만드는 서류 간격 vs 플레이어 처리 시간");
for(const lv of [1,2,3,4]){
  const trip0 = roundTrip(lv,0), tripN = roundTrip(lv, ROOM[lv-1].cap-1);
  console.log(`  사무실 Lv${lv}: 왕복 ${trip0.toFixed(1)}~${tripN.toFixed(1)}초`
    + ` → 1인 공급 간격 ${(13.5+trip0).toFixed(1)}~${(13.5+tripN).toFixed(1)}초`
    + ` (하루 ${(DAY_LEN/(13.5+trip0)).toFixed(1)}~${(DAY_LEN/(13.5+tripN)).toFixed(1)}건)`);
}
for(const [k,p] of Object.entries(PROFILES)){
  for(const R of [3,6,10]){
    const per = (p.t0+0.42*(R-3))+STAMP_LOCK;
    if(R===3||R===10) console.log(`  ${k}: 규정 ${R}개일 때 1건 ${per.toFixed(1)}초`
      + ` → 하루 ${(DAY_LEN/per).toFixed(1)}건 처리 (직원 ${(DAY_LEN/per/(DAY_LEN/(13.5+roundTrip(1,0)))).toFixed(1)}명분)`);
  }
}

report("보통", policyBalanced, "균형 운영 (정상 플레이)");
report("보통", policyNaive,   "순진한 확장 (되는대로 채용)");
report("초보", policyBalanced, "균형 운영");
report("숙련", policyBalanced, "균형 운영");
