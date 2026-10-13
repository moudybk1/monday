import {walletPerformance,type PxTrade} from '@monday/core';
const base={ts:1000,block:1,sym:'BTC',role:'maker',long:true,price:100,size:1,usd:100,funding:0} as const;
const close:PxTrade={...base,idx:3,kind:'close',side:'sell',fee:0,pnl:10};
const open:PxTrade={...base,idx:1,kind:'open',side:'buy',fee:1,pnl:0};
const actual=walletPerformance([close,open]);
const chronological=walletPerformance([open,close]);
console.log(JSON.stringify({actual,chronological,profitFactorBeforeSerialization:String(actual.profitFactor)},null,2));
