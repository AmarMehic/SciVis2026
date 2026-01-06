Data prep scripts live here (fetch DYAMOND GEOS files, slice, precompute streamlines/paths/particles). Use the `sci-vis` conda env from `environment.yml`.

## Hitra uporaba (GEOS vetrovi -> JSON za web)

1. Aktiviraj okolje: `conda activate sci-vis`.
2. Prenesi vseh 6 obrazov GEOS U/V (timestep=0, level=0) v NetCDF:
   ```bash
   python data/scripts/fetch_geos_faces.py
   ```
   - Vzame uradne DYAMOND GEOS idx URL-je in zapiše `notebooks/geos_faces/uv_face{0..5}.nc`.
3. Pretvori v regularno lat/lon mrežo in JSON za frontend:
   - Skripto lahko pokličeš takole: `python data/scripts/cubed_sphere_to_latlon.py` (zahteva vsaj vhodne datoteke, torej tiste .nc/.idx datoteke).
   - Rezultat je JSON z metapodatki in 2D polji U/V (privzeto `data/samples/uv_small.json`), ki ga web klient bere za prikaz vetrov.
   - Argumenti, ki jih lahko podaš:
     - `inputs` (positional): ena ali več poti do .nc/.idx (npr. 6 obrazov).
     - `--var-u/--var-v`: imeni spremenljivk (privzeto U/V).
     - `--time`: indeks ali timestamp (privzeto None → prvi).
     - `--level`: indeks/višina (privzeto None → prvi).
     - `--lon-res/--lat-res`: velikost izhodne lat/lon mreže (privzeto 360/181).
     - `--cube-coarsen`: celoštevilski faktor koarsenja pred projekcijo (auto, če izpustiš).
     - `--output`: pot do JSON (privzeto `data/samples/uv_small.json`).
     - `-v/--verbose`: poveča logiranje.
   - Polni primer z vsemi obrazi:
     ```bash
     python data/scripts/cubed_sphere_to_latlon.py notebooks/geos_faces/uv_face0.nc notebooks/geos_faces/uv_face1.nc notebooks/geos_faces/uv_face2.nc notebooks/geos_faces/uv_face3.nc notebooks/geos_faces/uv_face4.nc notebooks/geos_faces/uv_face5.nc --var-u U --var-v V --time 0 --level 0 --lon-res 360 --lat-res 181 --output data/samples/uv_small.json -v
     ```
4. Zaženi web: `npm run dev` in hard-reload; globe bere `uv_small.json` in riše tangentne vektorske črte.

## Generiranje ve nivojev za web (Path A: 1 JSON na nivo)

Web UI (slider) bere datoteke iz `web/public/data/wind/` v obliki `uv_level_XXX.json` in manifest `levels.json`.

### 1) Hitri demo (placeholder leveli iz obstojeega lat/lon JSON)

To je uporabno, e eli samo testirati multi-level exploration v UI, brez pravega 3D podvzorenja po nivojih.

```bash
python data/scripts/generate_wind_levels.py --mode placeholder --template-json data/samples/uv_small.json --levels 0-50 --out-dir web/public/data/wind
```

- Ustvari `uv_level_000.json` ... `uv_level_050.json`
- Ustvari/posodobi `web/public/data/wind/levels.json`

### 2) Pravi podatki (za vsak nivo ponovno zaeni cubed-sphere  sampler)

Najprej pripravi 6 obrazov (primer):

```bash
python data/scripts/fetch_geos_faces.py
```

Nato generiraj nivoje (npr. 0-10) kot loene JSON datoteke za web:

```bash
python data/scripts/generate_wind_levels.py \
  --mode cubed-sphere \
  --inputs notebooks/geos_faces/uv_face0.nc notebooks/geos_faces/uv_face1.nc notebooks/geos_faces/uv_face2.nc notebooks/geos_faces/uv_face3.nc notebooks/geos_faces/uv_face4.nc notebooks/geos_faces/uv_face5.nc \
  --var-u U --var-v V \
  --time 0 \
  --levels 0-10 \
  --lon-res 360 --lat-res 181 \
  --out-dir web/public/data/wind
```

Opomba: to je precej poasneje, ker za vsak nivo ponovno naredi nearest-neighbor mapping.

## Skripti

- `fetch_geos_faces.py`: prenese GEOS U/V za obraz 0–5 iz uradnega OpenVisus endpointa in shrani `uv_face*.nc` (dimenzije face,y,x; atributi time/level).
- `fetch_uv.py`: starejši primer, pobere en obraz U/V (subset ali celotni) in shrani `notebooks/uv_cube_t0_z0.nc`.
- `describe_nc.py`: povzetek `.nc` (dimenzije, koordinate, min/max).
- `cubed_sphere_to_latlon.py`: naloži eno ali več cubed-sphere datotek (NetCDF/IDX), po potrebi koarseni, projicira na lat/lon mrežo (nearest) in izpiše JSON z U/V + metapodatki (privzeto `data/samples/uv_small.json`).

### `cubed_sphere_to_latlon.py`

Pokličeš lahko preprosto:

```bash
python data/scripts/cubed_sphere_to_latlon.py
```

(v tem primeru moraš podati vhode, npr. kot argumente spodaj). Skripta kot izhod zgradi JSON z meta podatki in 2D polji U/V na regularni lat/lon mreži (privzeto `data/samples/uv_small.json`).

Argumenti:

- `inputs` (positional): ena ali več poti do .nc/.idx (npr. 6 obrazov).
- `--var-u/--var-v`: imeni spremenljivk (privzeto U/V).
- `--time`: indeks ali timestamp (privzeto None → prvi).
- `--level`: indeks/višina (privzeto None → prvi).
- `--lon-res/--lat-res`: velikost izhodne lat/lon mreže (privzeto 360/181).
- `--cube-coarsen`: celoštevilski faktor koarsenja pred projekcijo (auto, če izpustiš).
- `--output`: pot do JSON (privzeto `data/samples/uv_small.json`).
- `-v/--verbose`: poveča logiranje.

Kratek primer z vsemi obrazi:

```bash
python data/scripts/cubed_sphere_to_latlon.py notebooks/geos_faces/uv_face0.nc ... uv_face5.nc --output data/samples/uv_small.json
```

## Opombe

- Podatki: uradni DYAMOND GEOS vetrovi (U/V) iz SciVis 2026 vira: `https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/...`.
- Web prikaz: `web/src/main.js` bere `uv_small.json` in riše tangentne vektorje; gostota/dolžina se nastavlja z `stride`, `speedThreshold`, `opacity`, `color`, `lift`.
- Če želiš W (vertikalno hitrost), endpoint je analogen (`GEOS_W/w_face_{face}_...`); obdelava W še ni vključena v pretvornik ali prikaz.
