# Interactive Wind Feature Guide

## Kaj je bilo dodano?

### 1. Interaktivna Wind Komponenta (`interactiveWind.js`)
Nova komponenta, ki omogoča **klik na vetrne vektorje** za prikaz 3D listka na izbrani lokaciji.

**Funkcionalnosti:**
- ✅ Prikaz vetrnih vektorjev na globusu (barvani glede na hitrost)
- ✅ Raycasting za detekcijo klikov na vetrne vektorje
- ✅ Prikaz listka na kliknjeni lokaciji
- ✅ Listek je obarvan glede na hitrost vetra (modra → zelena → rumena → oranžna → rdeča)
- ✅ Listek je orientiran v smeri vetra
- ✅ Console log prikazuje podrobnosti o vetru (lat, lon, hitrost, U, V komponente)

### 2. Wind Legend Komponenta (`windLegend.js`)
DOM-based overlay, ki prikazuje legendo za barvno lestvico.

**Interakcija:**
   - **Klikni** na katerikoli vetrni vektor (barvne črtkice) na globusu
   - Na kliknjeni lokaciji se bo prikazal **3D listek**, obarvan glede na hitrost vetra

**Legenda:**
   - V **spodnjem desnem kotu** se prikazuje barvna legenda
   - Prikazuje mapiranje barv na hitrost vetra (počasi → hitro)

## Tehnične podrobnosti

### Komponente

#### `interactiveWind.js`
- **Input:** UV wind data (`data/samples/uv_small.json`)
- **Dependencies:** `camera`, `renderer`, `globeRadius`, `globeGroup`
- **3D Model:** `/models/tropical-leaf/source/fs.glb`
- **Raycasting:** Uporablja Three.js Raycaster za detekcijo klikov
- **Options:**
  - `stride`: Gostota vetrnih vektorjev
  - `poleStrideMul`: Dodatno redčenje pri polih
  - `jitter`: Random odmik za naravnejši izgled
  - `speedThreshold`: Minimalna hitrost za prikaz
  - `opacity`: Prosojnost vektorjev
  - `leafScale`: Velikost listka

#### `windLegend.js`
- **Input:** Samo options (brez data)
- **DOM-based:** Kreira HTML overlay element
- **Options:**
  - `position`: 'bottom-right', 'bottom-left', 'top-right', 'top-left'
  - `title`: Naslov legende (privzeto: 'Wind Speed')
  - `visible`: Prikaži/skrij (privzeto: true)

### Posodobitve v drugih datotekah

1. **`globe.js`**: Dodan `canvas` v return objekt
2. **`main.js`**: 
   - Dodan `camera` in `renderer` v `addComponent` factory
   - Zamenjan `windVectors` z `interactiveWind`
   - Dodan `windLegend`
   - Popravljen deprecated `assert` syntax v `with` syntax
