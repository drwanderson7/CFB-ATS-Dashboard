export const GAMES=Array.from({length:321},(_,i)=>({week:(i%13)+1,teams:['A','B']}));
export function applyKellyPoolSchedule(games){return {games,missing:[]};}
