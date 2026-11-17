# Planner benchmark (synthetic portfolios)

Environment: Node v20.20.2 on linux 6.1.189+, Intel(R) Xeon(R) Processor @ 2.60GHz, 2 logical CPUs, 1983 MB RAM. Command: `npx tsx scripts/benchmark-optimizer.ts --sizes 100,250,500,1000,2000 --repeats 3`.

risk-cvar-v5 defaults (500 optimisation + 2,000 evaluation scenarios, decomposition solver), risk 0.35, budget 35% of full-capacity cost. Invented numbers; this measures speed and memory, not plan quality.

| Products | Cold run | Warm runs (median) | Peak RSS (process) | RSS before planning | Relative gap (bound − objective) / bound | Spend / budget |
|---|---|---|---|---|---|---|
| 100 | 1.74 s | 1.54 s | 135 MB | 84 MB | 0.012% | 100.0% |
| 250 | 1.25 s | 1.09 s | 135 MB | 75 MB | 0.018% | 100.0% |
| 500 | 2.27 s | 2.07 s | 154 MB | 75 MB | 0.015% | 100.0% |
| 1,000 | 3.00 s | 2.87 s | 191 MB | 76 MB | 0.044% | 100.0% |
| 2,000 | 7.77 s | 7.57 s | 259 MB | 76 MB | 0.013% | 100.0% |

Plan API POST handler, 1,000 products, in-process (after the library runs above in the same process): HTTP 200 in 4.07 s, response 2.2 MB.

Cold = first plan in a fresh process (includes JIT warm-up). Peak RSS is the whole Node process (tsx loader included). Single run per row on a shared sandbox: expect variance between runs.
