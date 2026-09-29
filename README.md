# Growtopia Recipe Tree

A dependency-free static website that turns a plain-text Growtopia recipe list into a searchable, progressively unlocked visual dependency graph.

## Use it

Open `index.html` directly in a browser. The generated JavaScript data file means no local server is required.

Search for an item to display its two direct ingredients. Recipe children begin locked; click one to reveal its own two ingredients and continue one step at a time. Repeated seeds render once with every applicable recipe connected to the shared node. Drag to pan, scroll to zoom, or use the viewport controls.

## Update recipes

1. Add recipe lines to `data/recipes.txt` in the format `Output = Ingredient A + Ingredient B`.
2. Run `npm run build:data`.
3. Commit the updated source and generated files.

Generated outputs:

- `data/recipes.json` — portable structured data.
- `data/recipes-data.js` — browser-ready data for direct file access.

Run `npm run check` to confirm the generated files match the raw source. The converter rejects duplicate outputs, malformed recipes, ID collisions, and dependency cycles. Referenced items without recipes are retained as base items and reported as warnings.

## Images

Every item includes an `image` field set to `null`. Image paths can be added later; the interface currently renders an initial-based placeholder automatically.
