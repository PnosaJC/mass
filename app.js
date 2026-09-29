const data = window.GROWTOPIA_RECIPE_DATA;
const app = document.querySelector('#app');

if (!data?.items || !data?.recipes) {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `
    <section class="fatal-state">
      <span aria-hidden="true">!</span>
      <h1>Recipe data unavailable</h1>
      <p>Run <code>npm run build:data</code> to generate the browser data file.</p>
    </section>`;
  throw new Error('Growtopia recipe data was not loaded.');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 190;
const NODE_HEIGHT = 72;
const ROW_GAP = 148;
const MAX_ROW_GAP = 640;
const TARGET_TREE_ASPECT = 0.42;
const WORLD_MARGIN = 72;
const MIN_SCALE = 0.012;
const MAX_SCALE = 2.2;

const itemById = new Map(data.items.map((item) => [item.id, item]));
const recipeByOutput = new Map(data.recipes.map((recipe) => [recipe.output, recipe]));
const sortedItems = [...data.items].sort((left, right) => left.name.localeCompare(right.name));

app.setAttribute('aria-busy', 'false');
app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Growtopia Recipe Tree home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Growtopia <strong>Recipe Tree</strong></span>
    </a>
    <span class="data-count">${data.stats.recipes} recipes</span>
  </header>

  <section class="hero" aria-labelledby="page-title">
    <p class="eyebrow">Splice smarter</p>
    <h1 id="page-title">Every recipe, from the top down.</h1>
    <p class="hero-copy">Choose an item to reveal its complete splice dependency tree. Every branch is expanded automatically.</p>

    <form class="recipe-search" id="recipe-search" role="search" autocomplete="off">
      <div class="search-field">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.35-4.35m2.35-5.4A7.75 7.75 0 1 1 3.5 11.25a7.75 7.75 0 0 1 15.5 0Z"/></svg>
        <label class="sr-only" for="item-search">Search for an item</label>
        <input id="item-search" type="search" placeholder="Search 394 items…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" spellcheck="false">
        <button class="clear-search" id="clear-search" type="button" aria-label="Clear search" hidden>×</button>
      </div>
      <button class="explore-button" type="submit">Show recipe</button>
      <ul class="search-results" id="search-results" role="listbox" hidden></ul>
    </form>
  </section>

  <section class="tree-shell" aria-labelledby="tree-title">
    <div class="tree-heading">
      <div class="selection-copy">
        <p class="section-kicker">Currently exploring</p>
        <h2 id="tree-title">Recipe tree</h2>
        <p class="formula" id="recipe-formula"></p>
      </div>
      <div class="tree-meta" id="tree-meta" aria-live="polite"></div>
    </div>

    <div class="tree-frame">
      <div class="tree-toolbar">
        <div class="legend" aria-label="Tree legend">
          <span><i class="legend-dot selected"></i>Selected</span>
          <span><i class="legend-dot recipe"></i>Recipe</span>
          <span><i class="legend-dot base"></i>Base</span>
        </div>
        <p class="gesture-hint">Drag to move · Scroll to zoom</p>
        <div class="zoom-controls" aria-label="Tree zoom controls">
          <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
          <button id="fit-tree" type="button">Fit</button>
          <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
        </div>
      </div>
      <div class="tree-viewport" id="tree-viewport">
        <svg id="recipe-tree" role="img" aria-labelledby="tree-title tree-description">
          <desc id="tree-description">A top-down visual tree of the selected item and all ingredients required to splice it.</desc>
          <g id="tree-scene"></g>
        </svg>
      </div>
    </div>
  </section>

  <footer>
    <p>Built from ${data.stats.items} items · Missing recipes are shown as base items</p>
  </footer>`;

const searchForm = document.querySelector('#recipe-search');
const searchInput = document.querySelector('#item-search');
const searchResults = document.querySelector('#search-results');
const clearSearch = document.querySelector('#clear-search');
const treeTitle = document.querySelector('#tree-title');
const formula = document.querySelector('#recipe-formula');
const treeMeta = document.querySelector('#tree-meta');
const viewport = document.querySelector('#tree-viewport');
const svg = document.querySelector('#recipe-tree');
const scene = document.querySelector('#tree-scene');

let suggestionItems = [];
let activeSuggestion = -1;
let selectedId = null;
let currentLayout = null;
let view = { scale: 1, x: 0, y: 0 };
let dragState = null;

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function getSearchMatches(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sortedItems.filter((item) => item.hasRecipe).slice(0, 8);

  return sortedItems
    .map((item) => {
      const name = item.name.toLowerCase();
      let score = 4;
      if (name === normalized) score = 0;
      else if (name.startsWith(normalized)) score = 1;
      else if (name.split(/\s+/).some((word) => word.startsWith(normalized))) score = 2;
      else if (name.includes(normalized)) score = 3;
      return { item, score };
    })
    .filter(({ score }) => score < 4)
    .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name))
    .slice(0, 8)
    .map(({ item }) => item);
}

function setSuggestions(items) {
  suggestionItems = items;
  activeSuggestion = -1;
  searchResults.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'no-results';
    empty.textContent = 'No matching item found';
    searchResults.append(empty);
  } else {
    items.forEach((item, index) => {
      const option = document.createElement('li');
      option.id = `search-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.itemId = item.id;

      const name = document.createElement('strong');
      name.textContent = item.name;
      const type = document.createElement('span');
      type.textContent = item.hasRecipe ? (item.tier ? `Tier ${item.tier}` : 'Recipe') : 'Base item';
      option.append(name, type);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => selectItem(item.id));
      searchResults.append(option);
    });
  }

  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function closeSuggestions() {
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
  activeSuggestion = -1;
}

function setActiveSuggestion(index) {
  const options = [...searchResults.querySelectorAll('[role="option"]')];
  if (options.length === 0) return;
  activeSuggestion = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const isActive = optionIndex === activeSuggestion;
    option.setAttribute('aria-selected', String(isActive));
    if (isActive) option.scrollIntoView({ block: 'nearest' });
  });
  searchInput.setAttribute('aria-activedescendant', options[activeSuggestion].id);
}

function buildTree(rootId) {
  const nodes = [];
  const branches = [];
  const layers = [];
  let nextNodeNumber = 0;
  let maxDepth = 0;

  function createNode(itemId, depth, ancestors) {
    const node = {
      key: `tree-node-${nextNodeNumber++}`,
      itemId,
      depth,
      children: [],
      x: 0,
      y: 0,
    };
    nodes.push(node);
    if (!layers[depth]) layers[depth] = [];
    layers[depth].push(node);
    maxDepth = Math.max(maxDepth, depth);

    const recipe = recipeByOutput.get(itemId);
    const hasCycle = ancestors.has(itemId);
    if (!recipe || hasCycle) return node;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(itemId);
    const leftChild = createNode(recipe.ingredients[0], depth + 1, nextAncestors);
    const rightChild = createNode(recipe.ingredients[1], depth + 1, nextAncestors);
    node.children = [leftChild, rightChild];
    branches.push({ parent: node, children: node.children });
    return node;
  }

  const root = createNode(rootId, 0, new Set());
  const largestLayer = Math.max(...layers.map((layer) => layer.length));
  const worldWidth = largestLayer * NODE_WIDTH + WORLD_MARGIN * 2;
  const desiredWorldHeight = worldWidth * TARGET_TREE_ASPECT;
  const adaptiveRowGap = maxDepth === 0
    ? ROW_GAP
    : (desiredWorldHeight - NODE_HEIGHT - WORLD_MARGIN * 2) / maxDepth;
  const rowGap = Math.max(ROW_GAP, Math.min(MAX_ROW_GAP, adaptiveRowGap));
  const worldHeight = maxDepth * rowGap + NODE_HEIGHT + WORLD_MARGIN * 2;

  layers.forEach((layer, depth) => {
    const layerWidth = layer.length * NODE_WIDTH;
    const startX = (worldWidth - layerWidth) / 2 + NODE_WIDTH / 2;
    layer.forEach((node, index) => {
      node.x = startX + index * NODE_WIDTH;
      node.y = WORLD_MARGIN + NODE_HEIGHT / 2 + depth * rowGap;
    });
  });

  return {
    root,
    nodes,
    branches,
    levels: maxDepth + 1,
    worldWidth,
    worldHeight,
  };
}

function splitLabel(name) {
  const words = name.split(' ');
  const lines = [''];
  words.forEach((word) => {
    const current = lines[lines.length - 1];
    if (!current || `${current} ${word}`.length <= 18) {
      lines[lines.length - 1] = current ? `${current} ${word}` : word;
    } else if (lines.length < 2) {
      lines.push(word);
    } else {
      const last = lines[1];
      lines[1] = `${last} ${word}`;
    }
  });
  if (lines[1]?.length > 20) lines[1] = `${lines[1].slice(0, 18).trim()}…`;
  return lines;
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function renderTree(rootId) {
  const graph = buildTree(rootId);
  currentLayout = graph;
  scene.replaceChildren();

  graph.branches.forEach(({ parent, children }) => {
    const branchY = parent.y + NODE_HEIGHT / 2 + 26;

    scene.append(
      createSvgElement('path', {
        class: 'tree-edge trunk',
        d: `M ${parent.x} ${parent.y + NODE_HEIGHT / 2} L ${parent.x} ${branchY}`,
      }),
    );

    children.forEach((child) => {
      const targetY = child.y - NODE_HEIGHT / 2;
      const middleY = branchY + (targetY - branchY) * 0.55;
      scene.append(
        createSvgElement('path', {
          class: 'tree-edge',
          d: `M ${parent.x} ${branchY} C ${parent.x} ${middleY}, ${child.x} ${middleY}, ${child.x} ${targetY}`,
        }),
      );
    });

    const plus = createSvgElement('g', { class: 'branch-plus', transform: `translate(${parent.x} ${branchY})` });
    plus.append(createSvgElement('circle', { r: 11 }), createSvgElement('text', { x: 0, y: 1 }));
    plus.querySelector('text').textContent = '+';
    scene.append(plus);
  });

  graph.nodes.forEach((treeNode) => {
    const itemId = treeNode.itemId;
    const item = itemById.get(itemId);
    const position = treeNode;
    const isRoot = treeNode === graph.root;
    const node = createSvgElement('g', {
      class: `tree-node ${isRoot ? 'is-selected' : item.isBase ? 'is-base' : 'is-recipe'}`,
      transform: `translate(${position.x - NODE_WIDTH / 2} ${position.y - NODE_HEIGHT / 2})`,
      role: 'button',
      tabindex: '0',
      'aria-label': `${item.name}, ${item.isBase ? 'base item' : 'has a recipe'}. Show this item as the root.`,
    });

    const title = createSvgElement('title');
    title.textContent = `Explore ${item.name}`;
    node.append(title, createSvgElement('rect', { class: 'node-card', width: NODE_WIDTH, height: NODE_HEIGHT, rx: 14 }));

    if (item.image) {
      node.append(createSvgElement('image', { class: 'node-image', href: item.image, x: 12, y: 14, width: 44, height: 44 }));
    } else {
      node.append(createSvgElement('circle', { class: 'node-avatar', cx: 34, cy: 36, r: 21 }));
      const initials = createSvgElement('text', { class: 'node-initials', x: 34, y: 37 });
      initials.textContent = getInitials(item.name);
      node.append(initials);
    }

    const lines = splitLabel(item.name);
    const startY = lines.length === 1 ? 31 : 23;
    lines.forEach((line, index) => {
      const label = createSvgElement('text', { class: 'node-name', x: 66, y: startY + index * 17 });
      label.textContent = line;
      node.append(label);
    });

    const descriptor = createSvgElement('text', { class: 'node-type', x: 66, y: 58 });
    descriptor.textContent = item.isBase ? 'BASE ITEM' : item.tier ? `TIER ${item.tier}` : 'RECIPE';
    node.append(descriptor);

    const reroot = () => selectItem(itemId, { focusTree: false });
    node.addEventListener('pointerdown', (event) => event.stopPropagation());
    node.addEventListener('click', reroot);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        reroot();
      }
    });
    scene.append(node);
  });

  const rootItem = itemById.get(rootId);
  const rootRecipe = recipeByOutput.get(rootId);
  treeTitle.textContent = rootItem.name;
  formula.replaceChildren();

  if (rootRecipe) {
    const left = document.createElement('span');
    const plus = document.createElement('b');
    const right = document.createElement('span');
    const arrow = document.createElement('b');
    const result = document.createElement('strong');
    left.textContent = itemById.get(rootRecipe.ingredients[0]).name;
    plus.textContent = '+';
    right.textContent = itemById.get(rootRecipe.ingredients[1]).name;
    arrow.textContent = '=';
    result.textContent = rootItem.name;
    formula.append(left, plus, right, arrow, result);
  } else {
    formula.textContent = 'No recipe in the current data · treated as a base item';
  }

  const baseCount = graph.nodes.filter((node) => node.children.length === 0).length;
  treeMeta.innerHTML = `<strong>${graph.nodes.length}</strong> item nodes <i></i> <strong>${graph.levels}</strong> levels <i></i> <strong>${baseCount}</strong> base endpoints`;
  requestAnimationFrame(fitTree);
}

function applyView() {
  scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
}

function fitTree() {
  if (!currentLayout) return;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const padding = width < 600 ? 24 : 56;
  const scaleX = (width - padding * 2) / currentLayout.worldWidth;
  const scaleY = (height - padding * 2) / currentLayout.worldHeight;
  view.scale = Math.max(MIN_SCALE, Math.min(scaleX, scaleY, 1.15));
  view.x = (width - currentLayout.worldWidth * view.scale) / 2;
  view.y = (height - currentLayout.worldHeight * view.scale) / 2;
  applyView();
}

function zoomBy(multiplier, centerX = viewport.clientWidth / 2, centerY = viewport.clientHeight / 2) {
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * multiplier));
  const worldX = (centerX - view.x) / view.scale;
  const worldY = (centerY - view.y) / view.scale;
  view.x = centerX - worldX * nextScale;
  view.y = centerY - worldY * nextScale;
  view.scale = nextScale;
  applyView();
}

function selectItem(itemId, options = {}) {
  const item = itemById.get(itemId);
  if (!item) return;
  selectedId = itemId;
  searchInput.value = item.name;
  clearSearch.hidden = false;
  closeSuggestions();
  renderTree(itemId);

  const url = new URL(window.location.href);
  url.searchParams.set('item', itemId);
  window.history.replaceState({}, '', url);

  if (options.focusTree) document.querySelector('.tree-shell').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

searchInput.addEventListener('focus', () => setSuggestions(getSearchMatches(searchInput.value)));
searchInput.addEventListener('input', () => {
  clearSearch.hidden = !searchInput.value;
  setSuggestions(getSearchMatches(searchInput.value));
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (searchResults.hidden) setSuggestions(getSearchMatches(searchInput.value));
    setActiveSuggestion(activeSuggestion + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (searchResults.hidden) setSuggestions(getSearchMatches(searchInput.value));
    setActiveSuggestion(activeSuggestion - 1);
  } else if (event.key === 'Enter' && activeSuggestion >= 0) {
    event.preventDefault();
    selectItem(suggestionItems[activeSuggestion].id, { focusTree: true });
  } else if (event.key === 'Escape') {
    closeSuggestions();
  }
});
searchInput.addEventListener('blur', () => window.setTimeout(closeSuggestions, 100));

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const matches = getSearchMatches(searchInput.value);
  if (matches.length > 0) selectItem(matches[0].id, { focusTree: true });
  else setSuggestions([]);
});

clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  clearSearch.hidden = true;
  searchInput.focus();
  setSuggestions(getSearchMatches(''));
});

document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(0.8));
document.querySelector('#fit-tree').addEventListener('click', fitTree);

viewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  const bounds = viewport.getBoundingClientRect();
  zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: view.x, originY: view.y };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('is-dragging');
});
viewport.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  view.x = dragState.originX + event.clientX - dragState.x;
  view.y = dragState.originY + event.clientY - dragState.y;
  applyView();
});
viewport.addEventListener('pointerup', (event) => {
  if (dragState?.pointerId === event.pointerId) {
    dragState = null;
    viewport.classList.remove('is-dragging');
  }
});
viewport.addEventListener('pointercancel', () => {
  dragState = null;
  viewport.classList.remove('is-dragging');
});

let previousViewportWidth = viewport.clientWidth;
new ResizeObserver(() => {
  const currentWidth = viewport.clientWidth;
  if (Math.abs(currentWidth - previousViewportWidth) > 30) {
    previousViewportWidth = currentWidth;
    fitTree();
  }
}).observe(viewport);

const requestedId = new URLSearchParams(window.location.search).get('item');
selectItem(itemById.has(requestedId) ? requestedId : 'door');
