# ICP Search Rotation Strategy

This document outlines the systematic lead discovery rotation implemented in the Autonome Sales System. The goal of this rotation is to maximize Apify credit efficiency by ensuring that each search targets a unique segment of the market, preventing the repeated gathering of already-discovered leads.

## The Traveling Rotation Logic

The system utilizes a "Traveling Rotation" strategy across 14 distinct Ideal Customer Profiles (ICPs) and 3 geographic locations (USA, Canada, UK).

### How it Works:
1.  **Daily Cycles:** There are three discovery runs per day (9 AM, 1 PM, 5 PM).
2.  **Geographic Assignment:** 
    *   **Run 1 (9 AM):** United States
    *   **Run 2 (1 PM):** Canada
    *   **Run 3 (5 PM):** United Kingdom
3.  **Traveling ICPs:** Each ICP moves through the locations over a 3-day period.
    *   Day N: ICP-A (USA)
    *   Day N+1: ICP-A (Canada)
    *   Day N+2: ICP-A (UK)
4.  **Mathematical Formula:**
    The system calculates the `dayOfYear` and uses the `runNumber` to select the ICP index:
    `icpIndex = (dayOfYear - (runNumber - 1) + 14) % 14`

## ICP Directory

Below is the list of programmed ICPs as of January 20, 2026.

| ID | ICP Name | Target Industries | Focus Job Titles |
|:---|:---|:---|:---|
| 0 | Tech/SaaS CEOs/Founders | technology, software, saas | CEO, Founder, Co-Founder, President |
| 1 | Legal - Practice Admin | law, legal practice, legal services | Practice Administrator, Operations Director, Office Manager |
| 2 | Legal - Managing Partner | law, legal services | Managing Partner, Owner, Principal Attorney |
| 3 | Legal - Nonprofit Ops | nonprofit, legal aid | Program Operations Manager, Executive Director |
| 4 | Legal - Court Services | mediation, process server, court reporting | Operations Manager, Owner, Office Manager |
| 5 | Ag - Retailer/Co-op Ops | agriculture, agronomy, farm supply | Operations Manager, General Manager, Logistics Lead |
| 6 | Ag - Farm Manager/GM | agriculture, farming, crops, livestock | Farm Manager, General Manager, Operations Manager |
| 7 | Ag - Ag Logistics | logistics, warehousing, grain storage | Logistics Coordinator, Operations Lead, Warehouse Manager |
| 8 | Ag - Agronomy/Field Svc | agronomy, agriculture consulting | Operations Lead, Agronomy Services Manager |
| 9 | Marketing - Multi-location | marketing, advertising, dental, med spa | Marketing Operations Manager, Demand Gen Ops |
| 10 | Marketing - Delivery Ops | marketing agency, digital marketing | Client Delivery Ops, Director of Operations |
| 11 | Services - Field Ops | hvac, plumbing, electrical, pest control | Field Service Operations Manager, Service Manager |
| 12 | Services - Office Admin | accounting, consulting, insurance | Office Manager, Administrator, Operations Manager |
| 13 | Services - Property Mgmt | property management, real estate | Operations Lead, Property Manager, Site Manager |

## Implementation Details

The rotation is implemented in `src/scheduler.ts` within the `runDiscoveryStage` function.

### Key Variables in `.env`:
- `PIPELINE_LIMIT`: Controls the number of leads requested per run (Default: 300).
- `APIFY_API_TOKEN`: Used to authenticate with the Scraping service.

## Schedule Overview

| Time (EST) | Location | ICP Selection (Formula Result) |
|:---|:---|:---|
| 09:00 AM | United States | `dayOfYear % 14` |
| 01:00 PM | Canada | `(dayOfYear - 1) % 14` |
| 05:00 PM | United Kingdom | `(dayOfYear - 2) % 14` |

---
*Last Updated: 2026-01-20*
