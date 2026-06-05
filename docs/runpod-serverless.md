# RunPod Serverless Research Notes (Candidate for Production LLM Hosting)

Research date: 2026-05-31 / Purpose: Evaluating RunPod Serverless as a candidate backend for production LLM inference when running the "Capital of the Ayakashi (妖)" simulation in public (YouTube continuous stream + dedicated site).

> **[Historical note — its premises differ from the current policy]** This research is a record of the deliberations at the time, premised on a YouTube streaming setup. The current policy has changed: **YouTube streaming has been dropped (only a watch-only public web site)**, and **production also uses `claude -p` as-is** (see CLAUDE.md). The body below is left as it was, with the premises from when the research was done.

> Premises at the time: As the CLAUDE.md policy of the day stated, **production does not use `claude -p` (the Claude Code CLI)**. The production loop leans on the Anthropic API or self-hosting (= the RunPod Serverless of this document). This project already has an `ollama` backend, so the migration cost is small if we add a thin adapter for an OpenAI-compatible endpoint.

---

## 1. What RunPod Serverless Is

- A managed service that runs GPU inference **per request, billed by the second**. When idle, it **scales to zero** (zero workers = zero charge).
- **vLLM is natively integrated**, so you can drop in open models served over an OpenAI-compatible API (as of April 2026, roughly 40% of LLM endpoints were built on vLLM).
- Billing runs "from the moment a worker starts until it fully stops, rounded up to the second." **All three phases — container initialization, request execution, and idle timeout (default 5 seconds) — are billable.**

---

## 2. Pricing (Serverless / per-second billing)

From the official docs (docs.runpod.io/serverless/pricing). **Flex = start on demand (can scale to zero)**, **Active = always warm (25–35% discount, but billed continuously)**.

| GPU | VRAM | Flex $/sec | Active $/sec | Flex hourly equiv. |
|---|---|---|---|---|
| A4000 / A4500 / RTX4000 | 16GB | $0.00016 | $0.00011 | $0.576 |
| L4 / A5000 / 3090 | 24GB | $0.00019 | $0.00013 | $0.684 |
| 4090 PRO | 24GB | $0.00031 | $0.00021 | $1.116 |
| A6000 / A40 | 48GB | $0.00034 | $0.00024 | $1.224 |
| L40 / L40S / 6000 Ada | 48GB | $0.00053 | $0.00037 | $1.908 |
| A100 | 80GB | $0.00076 | $0.00060 | $2.736 |
| H100 PRO | 80GB | $0.00116 | $0.00093 | $4.176 |
| H200 PRO | 141GB | $0.00155 | $0.00124 | $5.580 |
| B200 | 180GB | $0.00240 | $0.00190 | $8.640 |

Note: Prices fluctuate with supply and demand. Serverless is roughly 2–3x the unit price of Pods (always-on), but in exchange you get FlashBoot and autoscaling.

---

## 3. Cold Starts and FlashBoot (the Crux of Cost Design)

- **FlashBoot**: A mechanism that pre-caches the container image and model weights on the host and keeps state after spin-down for fast recovery. When the cache hits, it claims "sub-200ms."
- **But large models are a different story**. The time to load weights into GPU VRAM is fundamentally unavoidable, and **for the 14–32B class it's realistically a dozen to several tens of seconds**. Moreover, **this load time is billed**.
- FlashBoot works better the more continuous the traffic. **The sparser the traffic (the longer the gaps), the more likely the cache misses and a cold start occurs** — a poor fit for this project's sparse calling pattern like "one tick per minute."

### Worker Types
- **Flex Worker**: Scales to zero when idle. Suited to bursty/intermittent traffic. The trade-off is cold-start latency.
- **Active Worker**: Keeps a minimum of N workers always warm. No cold starts, but **billed continuously even when idle** (25–35% cheaper than Flex).

### Related Settings
- **Idle Timeout** (default 5 sec): Stays warm for this many seconds after the last request = billed during that time. Lengthening it helps you make the next tick in time, but increases idle charges.
- **Scale Type**: For LLMs, `Request count` (aggressive scaling on pending + in-flight) is recommended.
- **Execution Timeout** (default 10 min): Guards against runaway jobs.
- **Max Workers**: The cap on concurrent workers = a guardrail on spending.

---

## 4. Estimates for This Project

### 4.1 The Inference Work of One Tick (based on measured prompt sizes)
- Up to 3 in the roster. On the normal path, the main cost is **decide (one request per living character, in parallel)**.
- One request ≈ 3,400–3,600 chars input / ~300 chars output. For 3 characters, ~10k input / ~900 output tokens.
- If vLLM's continuous batching bundles the 3 characters onto the same worker, **actual compute ≈ 10–15 GPU-seconds/tick** (prefill is fast + decoding 900 tokens ≈ 8–11s). On showcase ticks, dialogue/director adds a few more seconds.
- Model candidates (assuming they can handle Japanese introspection + strict JSON compliance):
  - **Qwen2.5-14B (4-bit ~9GB) → 24GB class (4090/L4)** … cheapest, decent quality
  - **Qwen2.5-32B (AWQ ~20GB) → 48GB class (A6000/L40S)** … quality-leaning, recommended

### 4.2 How Drastically the Unit Cost Shifts by Usage (the heart of the decision)

If you naively send "one tick per minute" as a fresh request each time, **you eat a cold start every tick**. That's fatal.

| Operating mode | GPU-sec/tick | A6000 Flex cost/tick | Per stream-hour (60 ticks) |
|---|---|---|---|
| **A. Naive**: fresh request every tick, immediate scale-to-zero | cold ~25 + compute ~13 = **~38** | ~$0.013 | **~$0.78/h** |
| **B. Keep warm**: don't scale to zero during the session | continuous billing (effectively 3600s/h) | — | **~$1.22/h** |
| **C. Batch prefetch**: generate 10 ticks in one burst | cold 25/10 + compute 13 = **~15.5** | ~$0.0053 | **~$0.32/h** |

**Conclusion: Mode C (prefetch batch) is by far the most efficient.**
The simulation can run ahead of display, so a design where you **start a worker once, generate N ticks at once → scale to zero → play back the pre-generated results slowly on the display side** gives you all three at once: (1) you divide the cold start by N, (2) high utilization while warm, and (3) zero GPU billing during playback.

### 4.3 Monthly Ballpark (assuming intermittent streaming ≈ 4 hours/day)

| Mode | Approx./month | Notes |
|---|---|---|
| RunPod Serverless mode C (A6000 prefetch) | **~$40** | Scales only with stream hours. Zero idle. |
| Anthropic Haiku 4.5 API (60 ticks/h) | ~$130 | Zero ops, top quality. $0.018/tick. |
| RunPod / other Pod always-on | ~$300–580 | Billed even during hours you're not streaming — pricey. |

> If you stream 24/7, the Serverless advantage (scale-to-zero) disappears and it's roughly the same as an Active worker or a Pod (~$950/month A100 class, ~$300–580/month mid-size). **The value of Serverless is maximized with "intermittent, bursty streaming."**

---

## 5. Recommended Architecture

1. **Split the production loop into "prefetch batch generation + buffered playback on the display side"** (mode C).
   - Sim side: start a worker once, generate N (e.g., 10–30) ticks in one go, and stash the results in a queue/DB.
   - Display side (YouTube stream + site): pull from the queue at a fixed interval and show them.
2. **Endpoint is vLLM (OpenAI-compatible)**. Add one **OpenAI-compatible backend** next to this project's `ollama` backend layer (keep the design so a `chatJSON` swap is all it takes).
3. **Start with the model Qwen2.5-32B AWQ / 48GB (A6000 Flex)**. Watch for JSON breakage and Japanese quality, then drop to 14B/24GB to optimize cost.
4. **Settings**: Scale Type = Request count, keep Max Workers low as a spending guardrail, keep Idle Timeout short (no need to wait around with prefetch batching). Use Network Volume + FlashBoot for the weights to shorten cold starts.
5. **Quality hybrid idea**: Use self-hosted vLLM for ordinary ticks, and send only the showcase moments (dialogue/director) to Haiku to guarantee staging quality.

---

## 5.5 Conclusion: For "On-Demand (Real-Time)," Haiku Is the Only Choice

The optimal answer splits along calling style. **If you advance ticks in real time, synced with the display = "fresh request each time," Haiku has the edge.**

| | Fresh request (real-time) | Prefetch batch |
|---|---|---|
| **Haiku 4.5 API** | ◎ no cold start, $0.018/tick, zero ops | ◎ same (no idle cost to begin with) |
| **RunPod Serverless** | ✕ pricey from cold-start billing every tick (~$0.78/h) | ◎ cheapest (~$0.32/h) |

- **Haiku's unit cost is the same whether "on-demand" or "batch"** (you pay only for the tokens used). It fits real-time streaming well and has no idle cost.
- **RunPod Serverless self-destructs in the "on-demand" case** from a cold start every tick. It only gets cheap **on the premise of prefetch batching**.

The decision is simple:
- **Want to advance ticks in real time → Haiku is the only choice** (and ops are easy).
- **Willing to build a design that separates display from generation and plays back from a buffer → RunPod Serverless can win on monthly cost** (~$40 vs ~$130 for intermittent streaming).

In other words, choosing RunPod = committing to the architecture investment of "prefetch batch + buffered playback." If you'd rather not bother with that work, Haiku is the straightforward choice.

---

## 6. Caveats / Risks

- **Cold starts for large models don't go away**. Don't break the premise of amortizing them via mode C (a design that hits the endpoint fresh every tick falls into the mode A trap).
- **Prices are dynamic**. This table is the official figures as of the research date. Verify actual costs in the console.
- **The quality wall**: Quantized open models may fall short of Haiku on Japanese introspection and strict JSON compliance. Beef up prompt retry/fallback (the existing 2-retry → fallback).
- **Operating cost**: Serverless removes server management, but image/model/endpoint maintenance still occurs. The Haiku API has zero ops. **Whether to offset "a difference of tens of dollars a month" with operational effort is a judgment call.**

---

## 7. Sources

- [RunPod Serverless Pricing (official)](https://docs.runpod.io/serverless/pricing)
- [Endpoint configurations (official)](https://docs.runpod.io/serverless/references/endpoint-configurations)
- [Serverless scaling strategy (RunPod Blog)](https://www.runpod.io/blog/serverless-scaling-strategy-runpod)
- [Scaling LLM Inference to Zero Cost During Downtime (RunPod)](https://www.runpod.io/articles/guides/runpod-secrets-scale-llm-inference-zero-cost)
- [Serverless GPU Pricing explainer (RunPod)](https://www.runpod.io/articles/guides/serverless-gpu-pricing)
- [Serverless LLM Deployment: RunPod vs Modal vs Lambda (2026)](https://blog.premai.io/serverless-llm-deployment-runpod-vs-modal-vs-lambda-2026/)
