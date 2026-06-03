import sqlite3
import csv
import random
from collections import defaultdict

random.seed(42)
DB = "metrics.db"

# ── Reference data ────────────────────────────────────────────────────────────

brands = [
    {"brand_id": "BRD01", "brand_name": "Nexavir",   "franchise": "Antiviral"},
    {"brand_id": "BRD02", "brand_name": "Cardolux",  "franchise": "Cardiovascular"},  # declining
    {"brand_id": "BRD03", "brand_name": "Neumora",   "franchise": "Neurology"},        # declining
    {"brand_id": "BRD04", "brand_name": "Oncleris",  "franchise": "Oncology"},
    {"brand_id": "BRD05", "brand_name": "Respithal", "franchise": "Respiratory"},      # launched 3m ago
    {"brand_id": "BRD06", "brand_name": "Veratenz",  "franchise": "Cardiovascular"},   # launched 10m ago
]

skus = [
    {"sku_id": "SKU001", "brand_id": "BRD01", "sku_name": "Nexavir 200mg Tablet 30ct",  "strength": "200mg",  "form": "Tablet",  "pack_size": 30, "list_price_usd": 120.00},
    {"sku_id": "SKU002", "brand_id": "BRD01", "sku_name": "Nexavir 400mg Tablet 30ct",  "strength": "400mg",  "form": "Tablet",  "pack_size": 30, "list_price_usd": 210.00},
    {"sku_id": "SKU003", "brand_id": "BRD01", "sku_name": "Nexavir 200mg Capsule 60ct", "strength": "200mg",  "form": "Capsule", "pack_size": 60, "list_price_usd": 230.00},
    {"sku_id": "SKU004", "brand_id": "BRD01", "sku_name": "Nexavir 400mg IV 10ml",      "strength": "400mg",  "form": "IV",      "pack_size": 1,  "list_price_usd": 980.00},
    {"sku_id": "SKU005", "brand_id": "BRD02", "sku_name": "Cardolux 10mg Tablet 90ct",  "strength": "10mg",   "form": "Tablet",  "pack_size": 90, "list_price_usd": 140.00},
    {"sku_id": "SKU006", "brand_id": "BRD03", "sku_name": "Neumora 25mg Capsule 28ct",  "strength": "25mg",   "form": "Capsule", "pack_size": 28, "list_price_usd": 310.00},
    {"sku_id": "SKU007", "brand_id": "BRD04", "sku_name": "Oncleris 100mg Vial",        "strength": "100mg",  "form": "Vial",    "pack_size": 1,  "list_price_usd": 4500.00},
    {"sku_id": "SKU008", "brand_id": "BRD05", "sku_name": "Respithal 250mcg Inhaler",   "strength": "250mcg", "form": "Inhaler", "pack_size": 1,  "list_price_usd": 285.00},
    {"sku_id": "SKU009", "brand_id": "BRD06", "sku_name": "Veratenz 20mg Tablet 30ct",  "strength": "20mg",   "form": "Tablet",  "pack_size": 30, "list_price_usd": 95.00},
]

competitors = [
    {"competitor_id": "CPT01", "competitor_name": "Viramix",    "franchise": "Antiviral"},
    {"competitor_id": "CPT02", "competitor_name": "Infectosol", "franchise": "Antiviral"},
    {"competitor_id": "CPT03", "competitor_name": "Antiluris",  "franchise": "Antiviral"},
    {"competitor_id": "CPT04", "competitor_name": "Cordivex",   "franchise": "Cardiovascular"},
    {"competitor_id": "CPT05", "competitor_name": "Heartanil",  "franchise": "Cardiovascular"},
    {"competitor_id": "CPT06", "competitor_name": "Vasorel",    "franchise": "Cardiovascular"},
    {"competitor_id": "CPT07", "competitor_name": "Pressocal",  "franchise": "Cardiovascular"},
    {"competitor_id": "CPT08", "competitor_name": "Neurostat",  "franchise": "Neurology"},
    {"competitor_id": "CPT09", "competitor_name": "Cognivex",   "franchise": "Neurology"},
    {"competitor_id": "CPT10", "competitor_name": "Tumorbex",   "franchise": "Oncology"},
    {"competitor_id": "CPT11", "competitor_name": "Oncosafe",   "franchise": "Oncology"},
    {"competitor_id": "CPT12", "competitor_name": "Malignix",   "franchise": "Oncology"},
    {"competitor_id": "CPT13", "competitor_name": "Bronchex",   "franchise": "Respiratory"},
    {"competitor_id": "CPT14", "competitor_name": "Pulmovir",   "franchise": "Respiratory"},
    {"competitor_id": "CPT15", "competitor_name": "Airsol",     "franchise": "Respiratory"},
    {"competitor_id": "CPT16", "competitor_name": "Breathalin", "franchise": "Respiratory"},
]

# ── Month range: 25 months ending 2026-05 ────────────────────────────────────

def make_months(start_year, start_month, n):
    result, y, m = [], start_year, start_month
    for _ in range(n):
        result.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return result

MONTHS = make_months(2024, 5, 25)   # indices 0-24 → 2024-05 … 2026-05

# Launch indices (months_idx into MONTHS)
# MONTHS[15] = 2025-08  ← Veratenz, launched 10 months ago
# MONTHS[22] = 2026-03  ← Respithal, launched  3 months ago
LAUNCH_MONTH_IDX = {"BRD05": 22, "BRD06": 15}

# ── Load regions ──────────────────────────────────────────────────────────────

regions = []
with open("territories.csv") as f:
    for row in csv.DictReader(f):
        regions.append({
            "region_name":    row["Name"],
            "territory_id":   row["Territory_ID"],
            "territory_name": row["Territory_Name"],
        })

# ── Regional weight vector ────────────────────────────────────────────────────

TERRITORY_POP = {
    "T01": 500, "T02": 400, "T03": 300, "T04": 350,
    "T05": 450, "T06": 1000, "T07": 800, "T08": 900,
    "T09": 700, "T10": 350, "T11": 750, "T12": 600,
}

territory_region_count = defaultdict(int)
for r in regions:
    territory_region_count[r["territory_id"]] += 1

raw_w = {}
for r in regions:
    tid = r["territory_id"]
    base = TERRITORY_POP[tid] / territory_region_count[tid]
    raw_w[r["region_name"]] = base * random.uniform(0.7, 1.3)

def normalize(w_dict):
    total = sum(w_dict.values())
    return {k: v / total for k, v in w_dict.items()}

region_weight_base = normalize(raw_w)

# Oncology: university hospital cities dominate
ONCO_BOOST = {
    "GE Genève": 8.0, "VD Lausanne": 8.0, "BE Bern": 8.0,
    "BS Basel": 8.0, "ZH Zürich": 8.0,
    "BE Thun": 3.0, "BE Biel": 3.0, "BE Burgdorf": 3.0,
    "VD Nyon": 3.0, "VD Morges": 3.0, "VD Vevey": 3.0, "VD Montreux": 3.0,
    "ZH Winterthur": 3.0, "ZH Wädenswil": 3.0, "ZH Dübendorf": 3.0,
    "BS Riehen": 3.0, "BL Allschwil": 3.0, "BL Binningen": 3.0, "BL Muttenz": 3.0,
    "SG St.Gallen": 3.0, "LU Luzern": 3.0, "TI Lugano": 3.0, "TI Bellinzona": 3.0,
    "AG Aarau": 3.0, "GR Chur": 3.0, "VS Sion": 3.0, "NE Neuchâtel": 3.0,
}

def onco_boost(rn):
    for prefix, f in ONCO_BOOST.items():
        if rn.startswith(prefix):
            return f
    return 1.0

region_weight_onco = normalize({rn: w * onco_boost(rn) for rn, w in raw_w.items()})

FRANCHISE_WEIGHTS = {
    "Antiviral":      region_weight_base,
    "Cardiovascular": region_weight_base,
    "Neurology":      region_weight_base,
    "Oncology":       region_weight_onco,
    "Respiratory":    region_weight_base,
}

# ── Regional adoption for launched brands ─────────────────────────────────────
# Each region gets an adoption lag (months after national launch) and a ramp speed.
# peak_factor scales the region's mature share (some regions adopt more than others).

region_adoption = {}
for r in regions:
    rn = r["region_name"]
    region_adoption[rn] = {
        "BRD06": {  # Veratenz: up to 4m lag, ramp 4-12m
            "lag":         random.randint(0, 4),
            "ramp_months": random.randint(4, 12),
            "peak_factor": random.uniform(0.5, 1.5),
        },
        "BRD05": {  # Respithal: 0-1m lag, ramp 3-8m
            "lag":         random.randint(0, 1),
            "ramp_months": random.randint(3, 8),
            "peak_factor": random.uniform(0.4, 1.6),
        },
    }

def adoption_factor(month_idx, launch_idx, lag, ramp_months):
    active = month_idx - launch_idx - lag
    if active < 0:
        return 0.0
    return min(1.0, (active + 1) / ramp_months)

# ── Volume and pricing ────────────────────────────────────────────────────────

USD_EUR = 0.93
NET     = 0.75   # 25% off list → net price

SKU_MIX = {
    "SKU001": 0.35, "SKU002": 0.30, "SKU003": 0.25, "SKU004": 0.10,
    "SKU005": 1.00, "SKU006": 1.00, "SKU007": 1.00,
    "SKU008": 1.00, "SKU009": 1.00,
}

sku_price = {s["sku_id"]: s["list_price_usd"] * USD_EUR * NET for s in skus}
brand_skus = defaultdict(list)
for s in skus:
    brand_skus[s["brand_id"]].append(s["sku_id"])

def brand_avg_net(bid):
    return sum(sku_price[sid] * SKU_MIX[sid] for sid in brand_skus[bid])

# trend > 0 → growing, trend < 0 → declining
# launch brands: national_units = mature volume, actual volume ramps from 0
BRAND_META = {
    "BRD01": {"national_units": 5000, "net_price_eur": brand_avg_net("BRD01"), "trend":  0.006},
    "BRD02": {"national_units": 3000, "net_price_eur": brand_avg_net("BRD02"), "trend": -0.008},  # declining
    "BRD03": {"national_units": 1500, "net_price_eur": brand_avg_net("BRD03"), "trend": -0.006},  # declining
    "BRD04": {"national_units":  800, "net_price_eur": brand_avg_net("BRD04"), "trend":  0.008},
    "BRD05": {"national_units": 4000, "net_price_eur": brand_avg_net("BRD05"), "trend":  0.012},  # new launch
    "BRD06": {"national_units": 2000, "net_price_eur": brand_avg_net("BRD06"), "trend":  0.010},  # new launch
}

COMP_META = {
    "CPT01": {"national_units": 4000, "net_price_eur":   85.0},
    "CPT02": {"national_units": 2500, "net_price_eur":   95.0},
    "CPT03": {"national_units": 1800, "net_price_eur":   70.0},
    "CPT04": {"national_units": 5000, "net_price_eur":   60.0},
    "CPT05": {"national_units": 3500, "net_price_eur":   80.0},
    "CPT06": {"national_units": 2000, "net_price_eur":   55.0},
    "CPT07": {"national_units": 1500, "net_price_eur":   45.0},
    "CPT08": {"national_units": 2000, "net_price_eur":  200.0},
    "CPT09": {"national_units": 1200, "net_price_eur":  180.0},
    "CPT10": {"national_units":  600, "net_price_eur": 3000.0},
    "CPT11": {"national_units":  400, "net_price_eur": 3500.0},
    "CPT12": {"national_units":  300, "net_price_eur": 2800.0},
    "CPT13": {"national_units": 6000, "net_price_eur":  180.0},
    "CPT14": {"national_units": 4500, "net_price_eur":  210.0},
    "CPT15": {"national_units": 3000, "net_price_eur":  195.0},
    "CPT16": {"national_units": 2000, "net_price_eur":  165.0},
}

# ── Generate sales rows ───────────────────────────────────────────────────────

sales_rows = []

for month_idx, ym in enumerate(MONTHS):
    for brand in brands:
        bid = brand["brand_id"]
        meta = BRAND_META[bid]
        launch_idx = LAUNCH_MONTH_IDX.get(bid)

        if launch_idx is not None and month_idx < launch_idx:
            continue  # brand not yet on market

        months_active = month_idx - (launch_idx if launch_idx is not None else 0)
        trend = (1 + meta["trend"]) ** months_active
        weights = FRANCHISE_WEIGHTS[brand["franchise"]]

        for region in regions:
            rn = region["region_name"]
            w = weights[rn]

            if launch_idx is not None:
                adopt = region_adoption[rn][bid]
                af = adoption_factor(month_idx, launch_idx, adopt["lag"], adopt["ramp_months"])
                if af == 0:
                    continue
                w = w * af * adopt["peak_factor"]

            units = max(0, round(meta["national_units"] * w * trend * random.uniform(0.85, 1.15)))
            if units == 0:
                continue
            sales_eur = round(units * meta["net_price_eur"], 2)
            sales_rows.append((
                ym, brand["brand_name"], brand["franchise"], 1,
                rn, region["territory_id"], region["territory_name"],
                units, sales_eur,
            ))

    for comp in competitors:
        cid = comp["competitor_id"]
        meta = COMP_META[cid]
        weights = FRANCHISE_WEIGHTS[comp["franchise"]]
        for region in regions:
            rn = region["region_name"]
            w = weights[rn]
            units = max(0, round(meta["national_units"] * w * random.uniform(0.85, 1.15)))
            if units == 0:
                continue
            sales_eur = round(units * meta["net_price_eur"], 2)
            sales_rows.append((
                ym, comp["competitor_name"], comp["franchise"], 0,
                rn, region["territory_id"], region["territory_name"],
                units, sales_eur,
            ))

# ── Generate forecast rows ────────────────────────────────────────────────────
# National ramp for launched brands: smooth S-shaped curve reaching ~100% at mature_months

def national_ramp(months_active, mature_months=15):
    """Simple sqrt ramp: reaches ~full volume after mature_months months."""
    return min(1.0, (months_active / mature_months) ** 0.6)

forecast_rows = []

for month_idx, ym in enumerate(MONTHS):
    for sku in skus:
        sid = sku["sku_id"]
        bid = sku["brand_id"]
        meta = BRAND_META[bid]
        launch_idx = LAUNCH_MONTH_IDX.get(bid)

        if launch_idx is not None and month_idx < launch_idx:
            continue  # not yet launched

        months_active = month_idx - (launch_idx if launch_idx is not None else 0)
        trend = (1 + meta["trend"]) ** months_active
        ramp  = national_ramp(months_active) if launch_idx is not None else 1.0

        units = round(meta["national_units"] * SKU_MIX[sid] * trend * ramp)
        if units <= 0:
            continue
        sales_eur = round(units * sku_price[sid], 2)
        forecast_rows.append((ym, sid, units, sales_eur))

# ── Write to DB ───────────────────────────────────────────────────────────────

con = sqlite3.connect(DB)
cur = con.cursor()

cur.executescript("""
DROP TABLE IF EXISTS forecast;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS competitors;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS skus;
DROP TABLE IF EXISTS brands;

CREATE TABLE brands (
    brand_id   TEXT PRIMARY KEY,
    brand_name TEXT NOT NULL,
    franchise  TEXT NOT NULL
);

CREATE TABLE skus (
    sku_id         TEXT PRIMARY KEY,
    brand_id       TEXT NOT NULL REFERENCES brands(brand_id),
    sku_name       TEXT NOT NULL,
    strength       TEXT NOT NULL,
    form           TEXT NOT NULL,
    pack_size      INTEGER NOT NULL,
    list_price_usd REAL NOT NULL
);

CREATE TABLE regions (
    region_name    TEXT PRIMARY KEY,
    territory_id   TEXT NOT NULL,
    territory_name TEXT NOT NULL
);

CREATE TABLE competitors (
    competitor_id   TEXT PRIMARY KEY,
    competitor_name TEXT NOT NULL,
    franchise       TEXT NOT NULL
);

CREATE TABLE sales (
    year_month     TEXT    NOT NULL,
    brand_name     TEXT    NOT NULL,
    franchise      TEXT    NOT NULL,
    is_own_brand   INTEGER NOT NULL,
    region_name    TEXT    NOT NULL,
    territory_id   TEXT    NOT NULL,
    territory_name TEXT    NOT NULL,
    units          INTEGER NOT NULL,
    sales_eur      REAL    NOT NULL
);

CREATE TABLE forecast (
    year_month TEXT NOT NULL,
    sku_id     TEXT NOT NULL REFERENCES skus(sku_id),
    units      INTEGER NOT NULL,
    sales_eur  REAL    NOT NULL,
    PRIMARY KEY (year_month, sku_id)
);

CREATE INDEX idx_sales_ym        ON sales(year_month);
CREATE INDEX idx_sales_brand     ON sales(brand_name);
CREATE INDEX idx_sales_franchise ON sales(franchise);
CREATE INDEX idx_sales_region    ON sales(region_name);
CREATE INDEX idx_sales_territory ON sales(territory_id);
CREATE INDEX idx_sales_own       ON sales(is_own_brand);
""")

cur.executemany("INSERT INTO brands      VALUES (:brand_id, :brand_name, :franchise)", brands)
cur.executemany("INSERT INTO skus        VALUES (:sku_id, :brand_id, :sku_name, :strength, :form, :pack_size, :list_price_usd)", skus)
cur.executemany("INSERT INTO regions     VALUES (:region_name, :territory_id, :territory_name)", regions)
cur.executemany("INSERT INTO competitors VALUES (:competitor_id, :competitor_name, :franchise)", competitors)
cur.executemany("INSERT INTO sales       VALUES (?,?,?,?,?,?,?,?,?)", sales_rows)
cur.executemany("INSERT INTO forecast    VALUES (?,?,?,?)", forecast_rows)
con.commit()
con.close()

print(f"Months : {MONTHS[0]} → {MONTHS[-1]}  ({len(MONTHS)} months)")
print(f"Sales  : {len(sales_rows):,} rows")
print(f"Fcst   : {len(forecast_rows)} rows")
print()
print("Brand dynamics:")
for b in brands:
    bid = b["brand_id"]
    meta = BRAND_META[bid]
    t = meta["trend"]
    launch = LAUNCH_MONTH_IDX.get(bid)
    launch_str = f"  launched {MONTHS[launch]}" if launch else ""
    flag = "▼ declining" if t < 0 else ("▲ new launch" if launch else "▲ growing")
    print(f"  {b['brand_name']:12s} {flag:12s}  trend {t:+.1%}/mo{launch_str}")
