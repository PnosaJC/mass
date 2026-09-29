import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const sourcePath = resolve(projectRoot, 'data/recipes.txt');
const jsonPath = resolve(projectRoot, 'data/recipes.json');
const browserDataPath = resolve(projectRoot, 'data/recipes-data.js');
const checkOnly = process.argv.includes('--check');

const NAME_ALIASES = new Map([
  ['tangram block (a to l)', 'Tangram Block'],
  ['tangram block (any)', 'Tangram Block'],
  ['tangram block', 'Tangram Block'],
]);

function cleanName(value) {
  const compact = value.trim().replace(/\s+/g, ' ');
  return NAME_ALIASES.get(compact.toLowerCase()) ?? compact;
}

function makeId(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseSource(source) {
  const lines = source.split(/\r?\n/);
  const explicitBaseNames = new Set();
  const recipeRows = [];
  const warnings = [];
  const errors = [];
  let tier = null;
  let section = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line) return;

    const tierMatch = line.match(/^Tier\s+(\d+)\s+Items$/i);
    if (tierMatch) {
      tier = Number(tierMatch[1]);
      section = `Tier ${tier}`;
      return;
    }

    if (/^(Winterfest Items|Colored Wallpapers|Wizard Hats|Surgical Tools)$/i.test(line)) {
      tier = null;
      section = line;
      return;
    }

    if (!line.includes('=')) {
      if (tier === 1) explicitBaseNames.add(cleanName(line));
      return;
    }

    const equalsParts = line.split(/\s*=\s*/);
    let outputName;
    let ingredientNames;

    if (equalsParts.length === 2) {
      outputName = cleanName(equalsParts[0]);
      ingredientNames = equalsParts[1].split(/\s*\+\s*/).map(cleanName);
    } else if (equalsParts.length === 3 && !line.includes('+')) {
      outputName = cleanName(equalsParts[0]);
      ingredientNames = equalsParts.slice(1).map(cleanName);
      warnings.push({
        code: 'corrected-separator',
        line: lineNumber,
        message: `Treated the second equals sign as a plus sign in “${line}”.`,
      });
    } else {
      errors.push({
        code: 'invalid-recipe',
        line: lineNumber,
        message: `Could not parse recipe “${line}”.`,
      });
      return;
    }

    if (!outputName || ingredientNames.length !== 2 || ingredientNames.some((name) => !name)) {
      errors.push({
        code: 'invalid-ingredients',
        line: lineNumber,
        message: `Recipe must contain one output and exactly two ingredients: “${line}”.`,
      });
      return;
    }

    recipeRows.push({ outputName, ingredientNames, tier, section, line: lineNumber });
  });

  const itemNames = new Map();
  const rememberName = (name) => {
    const key = name.toLowerCase();
    if (!itemNames.has(key)) itemNames.set(key, name);
  };

  explicitBaseNames.forEach(rememberName);
  recipeRows.forEach(({ outputName, ingredientNames }) => {
    rememberName(outputName);
    ingredientNames.forEach(rememberName);
  });

  const idOwners = new Map();
  const itemIdByKey = new Map();
  itemNames.forEach((name, key) => {
    const id = makeId(name);
    const existing = idOwners.get(id);
    if (existing && existing !== name) {
      errors.push({
        code: 'id-collision',
        message: `“${existing}” and “${name}” both normalize to the ID “${id}”.`,
      });
    }
    idOwners.set(id, name);
    itemIdByKey.set(key, id);
  });

  const recipeByOutput = new Map();
  recipeRows.forEach((row) => {
    const outputId = itemIdByKey.get(row.outputName.toLowerCase());
    if (recipeByOutput.has(outputId)) {
      errors.push({
        code: 'duplicate-recipe',
        line: row.line,
        message: `“${row.outputName}” has more than one recipe.`,
      });
      return;
    }

    recipeByOutput.set(outputId, {
      output: outputId,
      ingredients: row.ingredientNames.map((name) => itemIdByKey.get(name.toLowerCase())),
      tier: row.tier,
      section: row.section,
    });
  });

  const explicitBaseIds = new Set(
    [...explicitBaseNames].map((name) => itemIdByKey.get(name.toLowerCase())),
  );

  const outputDetails = new Map(
    recipeRows.map((row) => [
      itemIdByKey.get(row.outputName.toLowerCase()),
      { tier: row.tier, section: row.section },
    ]),
  );

  const items = [...itemNames.values()]
    .map((name) => {
      const id = itemIdByKey.get(name.toLowerCase());
      const details = outputDetails.get(id);
      const hasRecipe = recipeByOutput.has(id);
      return {
        id,
        name,
        tier: details?.tier ?? (explicitBaseIds.has(id) ? 1 : null),
        section: details?.section ?? (explicitBaseIds.has(id) ? 'Tier 1' : null),
        hasRecipe,
        isBase: !hasRecipe,
        image: null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const itemById = new Map(items.map((item) => [item.id, item]));
  const referencedIds = new Set([...recipeByOutput.values()].flatMap((recipe) => recipe.ingredients));

  [...referencedIds]
    .filter((id) => !recipeByOutput.has(id) && !explicitBaseIds.has(id))
    .sort((a, b) => itemById.get(a).name.localeCompare(itemById.get(b).name))
    .forEach((id) => {
      warnings.push({
        code: 'implicit-base',
        item: id,
        message: `“${itemById.get(id).name}” is referenced but has no recipe in the current list, so it is treated as a base item.`,
      });
    });

  const visitState = new Map();
  const path = [];
  function visit(itemId) {
    const state = visitState.get(itemId);
    if (state === 'done') return;
    if (state === 'visiting') {
      const cycleStart = path.indexOf(itemId);
      const cycle = [...path.slice(cycleStart), itemId].map((id) => itemById.get(id)?.name ?? id);
      errors.push({ code: 'recipe-cycle', message: `Recipe cycle found: ${cycle.join(' → ')}.` });
      return;
    }

    visitState.set(itemId, 'visiting');
    path.push(itemId);
    recipeByOutput.get(itemId)?.ingredients.forEach(visit);
    path.pop();
    visitState.set(itemId, 'done');
  }
  items.forEach((item) => visit(item.id));

  const recipes = [...recipeByOutput.values()].sort((left, right) =>
    itemById.get(left.output).name.localeCompare(itemById.get(right.output).name),
  );

  return {
    data: {
      version: 1,
      stats: {
        items: items.length,
        recipes: recipes.length,
        baseItems: items.filter((item) => item.isBase).length,
      },
      items,
      recipes,
      warnings,
    },
    errors,
  };
}

const source = await readFile(sourcePath, 'utf8');
const { data, errors } = parseSource(source);

if (errors.length > 0) {
  errors.forEach((error) => console.error(`ERROR: ${error.message}`));
  process.exitCode = 1;
} else {
  const jsonOutput = `${JSON.stringify(data, null, 2)}\n`;
  const browserOutput = `window.GROWTOPIA_RECIPE_DATA = ${JSON.stringify(data, null, 2)};\n`;

  if (checkOnly) {
    const [currentJson, currentBrowserData] = await Promise.all([
      readFile(jsonPath, 'utf8').catch(() => ''),
      readFile(browserDataPath, 'utf8').catch(() => ''),
    ]);

    if (currentJson !== jsonOutput || currentBrowserData !== browserOutput) {
      console.error('ERROR: Generated recipe files are missing or out of date. Run npm run build:data.');
      process.exitCode = 1;
    } else {
      console.log(`Recipe data is valid and current: ${data.stats.recipes} recipes, ${data.stats.items} items.`);
    }
  } else {
    await Promise.all([
      writeFile(jsonPath, jsonOutput),
      writeFile(browserDataPath, browserOutput),
    ]);
    console.log(`Generated ${data.stats.recipes} recipes across ${data.stats.items} items.`);
    data.warnings.forEach((warning) => console.warn(`WARNING: ${warning.message}`));
  }
}
