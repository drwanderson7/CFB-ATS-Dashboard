
function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):null;
}
function normalizedTeams(value){
  return [...new Set((Array.isArray(value)?value:[value]).filter(team=>typeof team==='string'&&team.trim()))];
}
function picksForWeek(entry,week){
  return normalizedTeams(entry?.picks?.[String(week)] ?? entry?.picks?.[week] ?? []);
}
function allEntryPicks(entry){
  return Object.entries(entry?.picks||{}).flatMap(([week,value])=>
    normalizedTeams(value).map(team=>({week:Number(week),team}))
  ).filter(row=>Number.isFinite(row.week));
}
function matchupFor(matchups,week,team){
  return (Array.isArray(matchups)?matchups:[]).find(m=>Number(m?.week)===Number(week)&&m?.team===team)||null;
}
function matchupStarted(matchup,nowMs=Date.now()){
  const t=Date.parse(matchup?.startDate||'');
  return matchup?.completed===true||(Number.isFinite(t)&&t<=nowMs);
}
function eventGameKey(matchup,week,team,opponent){
  const gameId=matchup?.gameId ?? matchup?.id ?? null;
  if(gameId!==null&&gameId!==undefined&&String(gameId)!=='')return `g:${String(gameId)}`;
  const sides=[team,opponent].filter(Boolean).map(String).sort().join('|');
  return `f:${Number(week)}:${sides}`;
}
function planEvents(plan,matchups){
  const events=[];
  for(const pick of plan?.picks||[]){
    if(pick?.skipped||pick?.conflict||!pick?.team)continue;
    const p=clamp01(pick.p);
    if(p===null||p<=0)continue;
    const m=matchupFor(matchups,pick.week,pick.team);
    events.push({
      gameKey:eventGameKey(m,pick.week,pick.team,m?.opponent),
      outcome:String(pick.team),
      p,
      week:Number(pick.week),
      team:String(pick.team),
      opponent:m?.opponent??null,
      gameId:m?.gameId??null
    });
  }
  return events;
}
function pathFromPlan(plan,matchups){
  const probability=plan?.coverageComplete?clamp01(plan.survivalProbability):null;
  return {
    probability,
    coverageComplete:plan?.coverageComplete===true,
    events:planEvents(plan,matchups)
  };
}
function intersectionProbability(paths){
  const outcomes=new Map();
  for(const path of paths){
    for(const event of path?.events||[]){
      const prior=outcomes.get(event.gameKey);
      if(prior&&prior.outcome!==event.outcome)return 0;
      if(!prior)outcomes.set(event.gameKey,event);
    }
  }
  let p=1;
  for(const event of outcomes.values())p*=event.p;
  return clamp01(p)??0;
}
function overlapMetrics(paths){
  const counts=new Map();
  let total=0;
  for(const path of paths){
    const seen=new Set();
    for(const event of path?.events||[]){
      const key=`${event.gameKey}::${event.outcome}`;
      if(seen.has(key))continue;
      seen.add(key);total++;
      counts.set(key,(counts.get(key)||0)+1);
    }
  }
  const shared=[...counts.values()].filter(count=>count>1);
  return {
    totalEventSlots:total,
    uniqueEvents:counts.size,
    sharedEventCount:shared.reduce((sum,count)=>sum+(count-1),0),
    sharedOutcomeCount:shared.length
  };
}
function exactUnionProbability(paths){
  const n=paths.length;
  let union=0;
  for(let mask=1;mask<(1<<n);mask++){
    const subset=[];
    let bits=0;
    for(let i=0;i<n;i++)if(mask&(1<<i)){subset.push(paths[i]);bits++;}
    const term=intersectionProbability(subset);
    union+=(bits%2===1?term:-term);
  }
  return Math.max(0,Math.min(1,union));
}
function seededRandom(seed){
  let x=seed>>>0;
  return ()=>{
    x=(x+0x6D2B79F5)>>>0;
    let t=x;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
function monteCarloUnion(paths,samples=16000){
  const games=new Map();
  for(const path of paths){
    for(const event of path.events||[]){
      if(!games.has(event.gameKey))games.set(event.gameKey,new Map());
      games.get(event.gameKey).set(event.outcome,event.p);
    }
  }
  const gameRows=[...games.entries()].map(([gameKey,sides])=>({gameKey,sides:[...sides.entries()].map(([outcome,p])=>({outcome,p}))}));
  const rng=seededRandom(0x50474346);
  let hits=0;
  for(let sample=0;sample<samples;sample++){
    const winners=new Map();
    for(const game of gameRows){
      const sides=game.sides;
      if(sides.length===1){
        winners.set(game.gameKey,rng()<sides[0].p?sides[0].outcome:null);
      }else{
        const primary=sides[0],secondary=sides[1],total=Math.max(0,primary.p)+Math.max(0,secondary.p);
        const primaryP=total>0?primary.p/total:primary.p;
        winners.set(game.gameKey,rng()<primaryP?primary.outcome:secondary.outcome);
      }
    }
    const survives=paths.some(path=>(path.events||[]).every(event=>winners.get(event.gameKey)===event.outcome));
    if(survives)hits++;
  }
  const probability=hits/samples;
  const standardError=Math.sqrt(Math.max(0,probability*(1-probability)/samples));
  return {probability,standardError,samples};
}
export function portfolioSurvivalProbability(paths,{maxExactEntries=12,monteCarloSamples=16000}={}){
  const usable=(Array.isArray(paths)?paths:[]).filter(path=>path?.coverageComplete&&clamp01(path.probability)!==null);
  if(!usable.length)return {probability:null,method:'unavailable',entryCount:0,standardError:null,...overlapMetrics([])};
  const overlap=overlapMetrics(usable);
  if(usable.length<=maxExactEntries){
    return {probability:exactUnionProbability(usable),method:'exact-inclusion-exclusion',entryCount:usable.length,standardError:0,...overlap};
  }
  const mc=monteCarloUnion(usable,monteCarloSamples);
  return {...mc,method:'seeded-monte-carlo',entryCount:usable.length,...overlap};
}
function entryPlanningContext(entry,currentWeek,picksPerWeek,matchups,nowMs=Date.now()){
  const priorUsed=new Set();
  const futureLocked={};
  const currentSaved=picksForWeek(entry,currentWeek);
  const startedCurrent=currentSaved.filter(team=>matchupStarted(matchupFor(matchups,currentWeek,team),nowMs));
  for(const row of allEntryPicks(entry)){
    if(row.week<currentWeek)priorUsed.add(row.team);
    else if(row.week>currentWeek){
      const key=String(row.week);
      const list=normalizedTeams(futureLocked[key]||[]);
      list.push(row.team);
      futureLocked[key]=normalizedTeams(list).slice(0,picksPerWeek);
    }
  }
  return {priorUsed,futureLocked,currentSaved,startedCurrent};
}
function currentPicksFromPlan(plan,currentWeek,matchups,picksPerWeek){
  return (plan?.picks||[])
    .filter(p=>Number(p.week)===Number(currentWeek)&&!p.skipped&&!p.conflict&&p.team)
    .slice(0,picksPerWeek)
    .map(pick=>{
      const m=matchupFor(matchups,currentWeek,pick.team);
      return {team:pick.team,p:clamp01(pick.p),opponent:m?.opponent??null,gameId:m?.gameId??null};
    });
}
function currentSignature(picks){
  return (picks||[]).map(row=>row.team).sort().join('|');
}
function validCurrentGroup(group,matchups,currentWeek){
  const games=new Set();
  for(const team of group){
    const m=matchupFor(matchups,currentWeek,team);
    if(!m)return false;
    const key=eventGameKey(m,currentWeek,team,m.opponent);
    if(games.has(key))return false;
    games.add(key);
  }
  return true;
}
function candidateGroups(entry,currentWeek,matchups,picksPerWeek,scoreApi,baselinePlan,context,maxUniverse=10,maxEvaluated=14){
  const mustKeep=context.startedCurrent.length?context.startedCurrent:(context.currentSaved.length>0&&context.currentSaved.length<picksPerWeek?context.currentSaved:[]);
  const futureUsed=new Set(Object.values(context.futureLocked).flatMap(normalizedTeams));
  const available=(Array.isArray(matchups)?matchups:[])
    .filter(m=>Number(m.week)===Number(currentWeek)&&!matchupStarted(m)&&!context.priorUsed.has(m.team)&&!futureUsed.has(m.team))
    .map(m=>({team:m.team,p:clamp01(scoreApi.probabilityFor?scoreApi.probabilityFor(m):m.winProbability),matchup:m}))
    .filter(row=>row.p!==null&&row.p>0)
    .sort((a,b)=>b.p-a.p||String(a.team).localeCompare(String(b.team)));
  const universe=available.slice(0,maxUniverse);
  const groups=[];
  const add=teams=>{
    const normalized=normalizedTeams(teams).slice(0,picksPerWeek);
    if(normalized.length!==picksPerWeek||!validCurrentGroup(normalized,matchups,currentWeek))return;
    const sig=normalized.slice().sort().join('|');
    if(!groups.some(g=>g.sig===sig))groups.push({teams:normalized,sig,immediateP:normalized.reduce((prod,team)=>{
      const row=available.find(x=>x.team===team);return prod*(row?.p??0);
    },1)});
  };
  add(currentPicksFromPlan(baselinePlan,currentWeek,matchups,picksPerWeek).map(row=>row.team));
  if(context.currentSaved.length===picksPerWeek)add(context.currentSaved);
  if(context.startedCurrent.length>=picksPerWeek)return groups;
  if(picksPerWeek===1){
    universe.forEach(row=>add([row.team]));
  }else if(mustKeep.length){
    universe.forEach(row=>add([...mustKeep,row.team]));
  }else{
    for(let i=0;i<universe.length;i++)for(let j=i+1;j<universe.length;j++)add([universe[i].team,universe[j].team]);
  }
  groups.sort((a,b)=>b.immediateP-a.immediateP);
  const priority=groups.filter(g=>{
    const sig=g.sig;
    return sig===currentSignature(currentPicksFromPlan(baselinePlan,currentWeek,matchups,picksPerWeek))||
      sig===context.currentSaved.slice().sort().join('|');
  });
  const rest=groups.filter(g=>!priority.includes(g)).slice(0,maxEvaluated);
  return [...priority,...rest].filter((g,i,arr)=>arr.findIndex(x=>x.sig===g.sig)===i);
}
function buildEntryOptions(entry,matchups,weeks,currentWeek,picksPerWeek,scoreApi,{maxCandidatesPerEntry=6}={}){
  const context=entryPlanningContext(entry,currentWeek,picksPerWeek,matchups);
  const allowedStarted=new Set(context.startedCurrent);
  const planningMatchups=(Array.isArray(matchups)?matchups:[]).filter(m=>
    Number(m.week)!==Number(currentWeek)||!matchupStarted(m)||allowedStarted.has(m.team)
  );
  const baselineLocks={...context.futureLocked};
  if(context.startedCurrent.length||(context.currentSaved.length>0&&context.currentSaved.length<picksPerWeek)){
    baselineLocks[String(currentWeek)]=context.startedCurrent.length?context.startedCurrent:context.currentSaved;
  }
  const baselinePlan=scoreApi.buildSeasonPlan(planningMatchups,weeks,context.priorUsed,baselineLocks,picksPerWeek);
  const baselineCurrent=currentPicksFromPlan(baselinePlan,currentWeek,planningMatchups,picksPerWeek);
  const groups=candidateGroups(entry,currentWeek,planningMatchups,picksPerWeek,scoreApi,baselinePlan,context);
  const options=[];
  const addPlan=(plan,source)=>{
    const currentPicks=currentPicksFromPlan(plan,currentWeek,matchups,picksPerWeek);
    if(currentPicks.length!==picksPerWeek)return;
    const signature=currentSignature(currentPicks);
    if(options.some(option=>option.signature===signature))return;
    const path=pathFromPlan(plan,matchups);
    options.push({
      signature,currentPicks,plan,path,
      pathProbability:path.probability,
      coverageComplete:path.coverageComplete,
      source
    });
  };
  addPlan(baselinePlan,'standalone');
  for(const group of groups){
    const locks={...context.futureLocked,[String(currentWeek)]:group.teams};
    const plan=scoreApi.buildSeasonPlan(planningMatchups,weeks,context.priorUsed,locks,picksPerWeek);
    addPlan(plan,'candidate');
  }
  options.sort((a,b)=>{
    if(a.coverageComplete!==b.coverageComplete)return a.coverageComplete?-1:1;
    return (b.pathProbability??-1)-(a.pathProbability??-1);
  });
  const standalone=options.find(option=>option.signature===currentSignature(baselineCurrent))||options[0]||null;
  const kept=options.slice(0,maxCandidatesPerEntry);
  if(standalone&&!kept.includes(standalone))kept.unshift(standalone);
  const savedSig=context.currentSaved.length===picksPerWeek?context.currentSaved.slice().sort().join('|'):null;
  const saved= savedSig ? options.find(option=>option.signature===savedSig) : null;
  if(saved&&!kept.includes(saved))kept.push(saved);
  return {entry,context,options:kept,standalone};
}
function beamScore(selections){
  const paths=selections.map(row=>row.option.path);
  const result=portfolioSurvivalProbability(paths,{maxExactEntries:10,monteCarloSamples:4000});
  const indiv=selections.reduce((sum,row)=>sum+(row.option.pathProbability??0),0);
  return {portfolio:result.probability??-1,individualSum:indiv};
}
export function buildDiversifiedPortfolio({
  matchups,weeks,entries,currentWeek,picksPerWeek=1,scoreApi,
  maxCandidatesPerEntry=6,beamWidth=80,maxOptimizedEntries=8
}={}){
  if(!scoreApi||typeof scoreApi.buildSeasonPlan!=='function')throw new Error('Survivor score API is required.');
  const required=Math.max(1,Number(picksPerWeek)||1);
  const entryRows=(Array.isArray(entries)?entries:[]).map(entry=>
    buildEntryOptions(entry,matchups,weeks,Number(currentWeek),required,scoreApi,{maxCandidatesPerEntry})
  ).filter(row=>row.standalone);
  const baselineSelections=entryRows.map(row=>({entry:row.entry,option:row.standalone,standalone:row.standalone}));
  const baseline=portfolioSurvivalProbability(baselineSelections.map(row=>row.option.path));
  if(entryRows.length<2){
    return {
      entryCount:entryRows.length,
      baseline:{...baseline,selections:baselineSelections},
      optimized:{...baseline,selections:baselineSelections},
      diversificationGain:0,
      optimizationLimited:false,
      optimizedEntryCount:entryRows.length
    };
  }
  const ranked=[...entryRows].sort((a,b)=>(b.standalone?.pathProbability??-1)-(a.standalone?.pathProbability??-1));
  const optimizable=ranked.slice(0,maxOptimizedEntries);
  const optimizedIds=new Set(optimizable.map(row=>row.entry.id));
  const fixed=entryRows.filter(row=>!optimizedIds.has(row.entry.id)).map(row=>({entry:row.entry,option:row.standalone,standalone:row.standalone}));
  let beam=[{selections:[],portfolio:0,individualSum:0}];
  for(const row of optimizable){
    const next=[];
    for(const state of beam){
      for(const option of row.options){
        const selections=[...state.selections,{entry:row.entry,option,standalone:row.standalone}];
        const scored=beamScore(selections);
        next.push({selections,portfolio:scored.portfolio,individualSum:scored.individualSum});
      }
    }
    next.sort((a,b)=>b.portfolio-a.portfolio||b.individualSum-a.individualSum);
    const dedup=[];
    const seen=new Set();
    for(const state of next){
      const sig=state.selections.map(sel=>`${sel.entry.id}:${sel.option.signature}`).join('||');
      if(seen.has(sig))continue;
      seen.add(sig);dedup.push(state);
      if(dedup.length>=beamWidth)break;
    }
    beam=dedup;
  }
  const best=beam[0]||{selections:optimizable.map(row=>({entry:row.entry,option:row.standalone,standalone:row.standalone}))};
  const order=new Map(entryRows.map((row,index)=>[row.entry.id,index]));
  const optimizedSelections=[...best.selections,...fixed].sort((a,b)=>(order.get(a.entry.id)??999)-(order.get(b.entry.id)??999));
  const optimized=portfolioSurvivalProbability(optimizedSelections.map(row=>row.option.path));
  return {
    entryCount:entryRows.length,
    baseline:{...baseline,selections:baselineSelections},
    optimized:{...optimized,selections:optimizedSelections},
    diversificationGain:baseline.probability!==null&&optimized.probability!==null?optimized.probability-baseline.probability:null,
    optimizationLimited:entryRows.length>maxOptimizedEntries,
    optimizedEntryCount:Math.min(entryRows.length,maxOptimizedEntries)
  };
}
