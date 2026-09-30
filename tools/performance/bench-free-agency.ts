import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createCareer } from '../../src/game/season/career';
import { advanceFreeAgencyDay } from '../../src/game/freeAgency/FreeAgencyService';

function pressureState() {
  const state=createCareer('perf-fa-probe');
  state.league.currentPhase='OFFSEASON_POST_DRAFT';
  state.freeAgency={opened:true,currentDay:1,offers:{},markets:{},settledPlayerDay:{},transactionLog:[]};
  for(const team of Object.values(state.teams)){
    const id=team.playerIds.pop();
    if(id){state.players[id].teamId='FREE_AGENT';state.players[id].contract.status='UFA';}
  }
  const template=Object.values(state.players).find(p=>p.teamId==='FREE_AGENT')!;
  for(let i=0;i<500;i++)state.players[`extra-${i}`]={...structuredClone(template),id:`extra-${i}`,name:`Extra ${i}`};
  advanceFreeAgencyDay(state,{mutate:true});
  const exemplar=Object.values(state.freeAgency!.offers)[0];
  if(!exemplar)throw new Error('No offer created');
  for(let i=0;i<1500;i++){
    const offerId=`past-${i}`;
    state.freeAgency!.offers[offerId]={...exemplar,offerId,playerId:`past-player-${i}`,status:'WITHDRAWN',createdDay:0};
  }
  return state;
}
const times=[];
let digest='';
for(let trial=0;trial<10;trial++){
  const state=pressureState();
  const start=performance.now();
  for(let day=0;day<3;day++)advanceFreeAgencyDay(state,{mutate:true});
  times.push(Math.round((performance.now()-start)*10)/10);
  digest=createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
console.log(JSON.stringify({players:980,legacyOffers:1500,days:3,times,digest}));
