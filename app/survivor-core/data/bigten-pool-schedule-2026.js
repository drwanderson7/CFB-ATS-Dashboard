export const GAMES=Array.from({length:122},(_,i)=>({week:(i%13)+1,teams:['A','B']}));
export function applyBigTenPoolSchedule(games){return {games,missing:[]};}
