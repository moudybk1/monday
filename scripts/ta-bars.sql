-- 1-minute taker bars per market from the stats indexer's tape, for scripts/ta-backtest.ts:
--   sqlite3 -readonly -csv -header apps/server/data/perpl-stats-mainnet.sqlite < scripts/ta-bars.sql > bars.csv
-- o/c: first and last taker print of the minute; slo: lowest price a taker sold at; bhi: highest a taker bought at;
-- buy/sell: taker USD volume by direction. Perp ids: 1 BTC, 20 ETH, 31 SOL.
with t as (select perp, ts/60000 m, block, idx, price, size, long from px_trades where taker=1 and perp in (1,20,31)),
g as (select perp, m, min(price) lo, max(price) hi, min(case when long=0 then price end) slo, max(case when long=1 then price end) bhi,
      sum(case when long=1 then price*size else 0 end) buy, sum(case when long=0 then price*size else 0 end) sell, count(*) n,
      min(block*100000+idx) k0, max(block*100000+idx) k1 from t group by perp, m)
select g.perp, g.m, o.price o, c.price c, g.lo, g.hi, g.slo, g.bhi, round(g.buy,2) buy, round(g.sell,2) sell, g.n
from g join px_trades o on o.block = g.k0/100000 and o.idx = g.k0%100000 join px_trades c on c.block = g.k1/100000 and c.idx = g.k1%100000
order by g.perp, g.m;
