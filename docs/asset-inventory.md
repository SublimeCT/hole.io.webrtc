# Asset Inventory

## Licenses

| Pack                         | Source                                 | License | Local license                                        |
| ---------------------------- | -------------------------------------- | ------- | ---------------------------------------------------- |
| Kenney Car Kit               | `kenney.nl/assets/car-kit`             | CC0 1.0 | `assets/kits/kenney-car-kit/LICENSE.txt`             |
| Kenney City Kit (Suburban)   | `kenney.nl/assets/city-kit-suburban`   | CC0 1.0 | `assets/kits/kenney-city-kit-suburban/LICENSE.txt`   |
| Kenney City Kit (Commercial) | `kenney.nl/assets/city-kit-commercial` | CC0 1.0 | `assets/kits/kenney-city-kit-commercial/LICENSE.txt` |
| Kenney Blocky Characters 2.0 | `kenney.nl/assets/blocky-characters`   | CC0 1.0 | `assets/kits/kenney-blocky-characters/LICENSE.txt`   |

## Runtime Prefabs

| Category             | Files                                                                                                                                                                       | Meaning                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Buildings            | `building-type-a.glb` through `building-type-u.glb`                                                                                                                         | Detached suburban houses and house variants            |
| Commercial buildings | `building-a.glb` through `building-h.glb`, `building-skyscraper-a.glb` through `building-skyscraper-d.glb`, `low-detail-building-a.glb` through `low-detail-building-h.glb` | Commercial blocks, towers, and compact storefronts     |
| Vehicles             | `sedan`, `hatchback-sports`, `suv`, `taxi`, `police`, `van`, `delivery`, `truck`, `ambulance`, `firetruck`, `garbage-truck`                                                 | Road vehicles matching each filename                   |
| Landscaping          | `tree-small`, `tree-large`, `planter`, `fence`, `fence-low`                                                                                                                 | Trees, street planters, and residential fences         |
| Small road objects   | `cone`, `cone-flat`, `box`                                                                                                                                                  | Upright/fallen traffic cones and cardboard cargo boxes |
| Vehicle debris       | `debris-tire`, `debris-bumper`, `debris-plate-a`, `debris-plate-small-a`                                                                                                    | Loose tire, bumper, and metal body plates              |
| Pedestrians          | `character-a.glb` through `character-r.glb`                                                                                                                                 | 18 animated blocky character variants                  |

All filenames above use the `.glb` extension. Both packs use `models/Textures/colormap.png`.

## Scale Policy

- Simulation units are meters.
- Runtime models are normalized from their loaded bounding boxes to the dimensions in `packages/shared/simulation/prefabs.ts`.
- Sedan target size is `2 × 4.2 × 1.6m`; vehicle variants range from `1.9 × 3.8 × 1.55m` to `2.5 × 6.5 × 3m`.
- Suburban houses range from `8.2-9.6m` wide, `7.2-8m` deep, and `5.8-7.75m` high.
- The model origin is recentered to the bounding-box center, then placed at half its target height so its bottom touches ground level.
- Character target size is `0.72 × 0.52 × 1.8m`; moving pedestrians use the included `walk` animation clip.
- Commercial storefronts are normalized to roughly `4.8 × 4.8 × 7-9m`; commercial buildings and towers use `8.55-9.1m` footprints and `12-36m` heights.

## Blocky Character Variants

| Files                          | Contents                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| `character-a` to `character-c` | Outdoor pedestrian, red-shirt pedestrian, senior pedestrian           |
| `character-d` to `character-f` | Crash-test character, purple-shirt pedestrian, green-shirt pedestrian |
| `character-g` to `character-i` | Red service robot, purple service robot, scientist                    |
| `character-j` to `character-l` | Police officer, casual pedestrian, suited zombie                      |
| `character-m` to `character-o` | Utility worker, mime, casual zombie                                   |
| `character-p` to `character-r` | Uniformed pedestrian, business pedestrian, ninja character            |

Each character contains 27 clips: `static`, `idle`, `walk`, `sprint`, `sit`, `drive`, `die`, `pick-up`, emotes, holding/shooting, melee attacks, interactions, and wheelchair movement variants. Runtime currently uses `walk` only.

## Imported Car Kit Files

`ambulance.glb`, `box.glb`, `cone-flat.glb`, `cone.glb`, `debris-bolt.glb`, `debris-bumper.glb`, `debris-door-window.glb`, `debris-door.glb`, `debris-drivetrain-axle.glb`, `debris-drivetrain.glb`, `debris-nut.glb`, `debris-plate-a.glb`, `debris-plate-b.glb`, `debris-plate-small-a.glb`, `debris-plate-small-b.glb`, `debris-spoiler-a.glb`, `debris-spoiler-b.glb`, `debris-tire.glb`, `delivery-flat.glb`, `delivery.glb`, `firetruck.glb`, `garbage-truck.glb`, `hatchback-sports.glb`, `kart-oobi.glb`, `kart-oodi.glb`, `kart-ooli.glb`, `kart-oopi.glb`, `kart-oozi.glb`, `police.glb`, `race-future.glb`, `race.glb`, `sedan-sports.glb`, `sedan.glb`, `suv-luxury.glb`, `suv.glb`, `taxi.glb`, `tractor-police.glb`, `tractor-shovel.glb`, `tractor.glb`, `truck-flat.glb`, `truck.glb`, `van.glb`, `wheel-dark.glb`, `wheel-default.glb`, `wheel-racing.glb`, `wheel-tractor-back.glb`, `wheel-tractor-dark-back.glb`, `wheel-tractor-dark-front.glb`, `wheel-tractor-front.glb`, `wheel-truck.glb`.

## Imported Suburban Kit Files

`building-type-a.glb` through `building-type-u.glb`, `driveway-long.glb`, `driveway-short.glb`, `fence-1x2.glb`, `fence-1x3.glb`, `fence-1x4.glb`, `fence-2x2.glb`, `fence-2x3.glb`, `fence-3x2.glb`, `fence-3x3.glb`, `fence-low.glb`, `fence.glb`, `path-long.glb`, `path-short.glb`, `path-stones-long.glb`, `path-stones-messy.glb`, `path-stones-short.glb`, `planter.glb`, `tree-large.glb`, `tree-small.glb`.

## Imported Commercial Kit Files

Runtime commercial prefabs use `building-a.glb` through `building-h.glb`, `building-skyscraper-a.glb` through `building-skyscraper-d.glb`, and `low-detail-building-a.glb` through `low-detail-building-h.glb`.

The local kit also contains `building-i.glb` through `building-n.glb`, `building-skyscraper-e.glb`, `low-detail-building-i.glb` through `low-detail-building-n.glb`, `low-detail-building-wide-a.glb`, `low-detail-building-wide-b.glb`, `detail-awning.glb`, `detail-awning-wide.glb`, `detail-overhang.glb`, `detail-overhang-wide.glb`, `detail-parasol-a.glb`, and `detail-parasol-b.glb`; these are retained under `assets/kits/kenney-city-kit-commercial/models` for future map composition.

## Imported Blocky Characters Files

`character-a.glb` through `character-r.glb`, `Textures/texture-a.png` through `Textures/texture-r.png`.
