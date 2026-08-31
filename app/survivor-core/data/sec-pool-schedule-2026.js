export const GAMES=Array.from({length:106},(_,i)=>({week:(i%13)+1,teams:['A','B']}));
export function applySecPoolSchedule(games){return {games,missing:[]};}
