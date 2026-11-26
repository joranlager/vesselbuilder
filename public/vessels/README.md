# Vessels folder

Rudder looks here for a ship's model before it builds one from the ship's type and size. A model
found here is used everywhere the ship is drawn: in the ship builder (**Ships**) and as the 3D
ship on the chart. After this folder, Rudder looks among the models saved on the device (Ships →
Save on this device), and only then builds the ship.

## Adding a model

The ship builder (**Ships**) does all of this in one step with **Commit to GitHub** (a token in
Settings → GitHub), or makes the files with **Download .glb and .json**. By hand:

1. Put the model file here: `.glb` (best: one file with its textures), `.gltf` (with its `.bin` and
   pictures), `.obj` (with its `.mtl` and pictures), `.stl`, `.ply`, `.fbx`, `.dae` or `.3mf`.
2. Next to it, a sidecar with the same name and `.json`, saying which ship it is and how it lies.
   Ships → **Download .glb and .json** makes both for the model in view.
3. Run `npm run vessels`. It writes `index.json`, the list Rudder reads (the build does this too, and
   a test fails if the committed list is out of date).

```json
{
  "name": "Color Magic",
  "mmsi": ["257123000"],
  "imo": "9349863",
  "callSign": "LAGV7",
  "aliases": ["MS Color Magic"],
  "up": "+y",
  "forward": "+x",
  "scale": "length",
  "length": 223.7,
  "draft": 6.8,
  "waterline": "keel",
  "textures": { "hull": { "file": "color-magic-hull.jpg" }, "deck": { "file": "teak.jpg", "tile": 4 } },
  "credit": "Model by …",
  "license": "CC BY 4.0"
}
```

Every field is optional:

| Field | Meaning |
|---|---|
| `file` | The model, when its name differs from the sidecar's. |
| `mmsi`, `imo`, `callSign`, `name`, `aliases` | How the ship is recognised: MMSI first, then IMO number, call sign, and name. A name alone is not used when the ship's MMSI or IMO number says it is another ship of that name. |
| `up`, `forward` | Which of the model's axes point up and towards the bow: `+x`, `-x`, `+y`, `-y`, `+z`, `-z`. glTF is usually `+y` up; CAD and STL files often `+z`. Default `+y` and `+x`. |
| `scale` | `"length"` (default): stretched to the ship's length from AIS, else `length`. A number: the model's units in metres (1 for metres, 0.01 for centimetres). |
| `length`, `beam`, `draft` | The ship's size in metres, used when AIS does not give it. |
| `waterline` | `"keel"` (default): the keel goes `draft` metres under the water. `"origin"`: the model's own height 0 is the waterline (models saved by Rudder are made so). |
| `textures` | Pictures to put on the model's materials, by material name: a file here, and `tile` (metres a repeat covers) to repeat it; without `tile` it is laid on the model's own texture coordinates. |
| `credit`, `license` | Who made it, and under which terms. Kept with the model. |

On the chart only the part above the waterline is drawn, so `draft` (or `waterline`) matters.
