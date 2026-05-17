'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type FallingBlock = {
  colorIndex: number;
  column: number;
  speed: number;
  y: number;
};

const instancesPerColor = 256;
const stackClearIntervalMs = 4000;
const logoBlockColorStops = [
  '#FFC1D6',
  '#FF94BE',
  '#FF5A95',
  '#FF3B7D',
  '#FF2D6F',
  '#B81D58',
  '#75183C',
  '#661631',
  '#461526',
];

function isTestRuntime() {
  return (
    process.env.NODE_ENV === 'test' ||
    (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom'))
  );
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function makeLogoBlockPalette() {
  const baseColors = logoBlockColorStops.map((color) => new THREE.Color(color));
  const palette: THREE.Color[] = [];

  for (let index = 0; index < 32; index += 1) {
    const start = baseColors[index % baseColors.length] ?? new THREE.Color('#FF2D6F');
    const end = baseColors[(index * 5 + 3) % baseColors.length] ?? start;
    const color = start.clone().lerp(end, 0.24 + (Math.sin(index * 12.9898) + 1) * 0.26);
    const hsl = { h: 0, l: 0, s: 0 };

    color.getHSL(hsl);
    color.setHSL(
      hsl.h + Math.sin(index * 1.7) * 0.008,
      THREE.MathUtils.clamp(hsl.s + Math.cos(index * 2.1) * 0.08, 0.58, 1),
      THREE.MathUtils.clamp(hsl.l + Math.sin(index * 0.9) * 0.08, 0.18, 0.84)
    );
    palette.push(color);
  }

  return palette;
}

export function LiveTetrisBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || isTestRuntime()) {
      return;
    }

    const tetrisContainer = container;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const matrix = new THREE.Object3D();
    const palette = makeLogoBlockPalette();
    const colorMeshes = palette.map((color) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        depthWrite: false,
        opacity: 0.62,
        transparent: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, instancesPerColor);

      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);

      return {
        count: 0,
        material,
        mesh,
      };
    });
    const stacks: number[][] = [];
    const fallingBlocks: FallingBlock[] = [];

    let animationFrame = 0;
    let blockSize = 36;
    let cellSize = 44;
    let columnCount = 16;
    let maxStackRows = 8;
    let previousTime = 0;
    let previousTimedClear = 0;
    let viewportHeight = 720;

    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'task-market-live-tetris-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.setAttribute('data-testid', 'live-tetris-background-canvas');
    tetrisContainer.appendChild(renderer.domElement);

    function stackHeightFor(column: number) {
      return stacks[column]?.length ?? 0;
    }

    function clearCompletedRows() {
      let clearedRows = 0;

      while (stacks.length > 0 && stacks.every((stack) => stack.length > 0)) {
        for (const stack of stacks) {
          stack.shift();
        }

        clearedRows += 1;

        if (clearedRows > maxStackRows) {
          break;
        }
      }
    }

    function clearBottomRows(rowCount: number) {
      for (const stack of stacks) {
        stack.splice(0, Math.min(rowCount, stack.length));
      }
    }

    function trimTallStacks() {
      for (const stack of stacks) {
        if (stack.length > maxStackRows) {
          stack.splice(0, stack.length - maxStackRows);
        }
      }
    }

    function pickColumn() {
      const occupiedColumns = new Set(fallingBlocks.map((block) => block.column));
      let fallbackColumn = Math.floor(Math.random() * columnCount);

      for (let attempt = 0; attempt < columnCount * 2; attempt += 1) {
        const column = Math.floor(Math.random() * columnCount);

        if (!occupiedColumns.has(column) && stackHeightFor(column) < maxStackRows) {
          return column;
        }

        if (stackHeightFor(column) < stackHeightFor(fallbackColumn)) {
          fallbackColumn = column;
        }
      }

      return fallbackColumn;
    }

    function spawnBlock(offset = 0) {
      const block = {
        colorIndex: Math.floor(Math.random() * palette.length),
        column: pickColumn(),
        speed: randomBetween(cellSize * 1.6, cellSize * 2.35),
        y: viewportHeight + cellSize * randomBetween(1.4 + offset, 7.4 + offset),
      };

      fallingBlocks.push(block);

      return block;
    }

    function seedStacks() {
      stacks.length = 0;

      for (let column = 0; column < columnCount; column += 1) {
        const stack = [];
        const laneGap = column % 9 === 0 || column % 13 === 0;
        const baseHeight = 3.2 + Math.sin(column * 0.84) * 2.4 + Math.cos(column * 0.37) * 1.2;
        const height = laneGap ? 1 : Math.max(2, Math.round(baseHeight));

        for (let row = 0; row < Math.min(height, maxStackRows); row += 1) {
          stack.push((column + row) % palette.length);
        }

        stacks.push(stack);
      }
    }

    function writeBlock(column: number, y: number, colorIndex: number) {
      const colorMesh = colorMeshes[colorIndex % colorMeshes.length];

      if (!colorMesh || colorMesh.count >= instancesPerColor) {
        return;
      }

      const x = column * cellSize + cellSize / 2;

      matrix.position.set(x, y, 0);
      matrix.rotation.set(0, 0, 0);
      matrix.scale.set(blockSize, blockSize, 1);
      matrix.updateMatrix();
      colorMesh.mesh.setMatrixAt(colorMesh.count, matrix.matrix);
      colorMesh.count += 1;
    }

    function renderBlocks() {
      for (const colorMesh of colorMeshes) {
        colorMesh.count = 0;
      }

      for (let column = 0; column < stacks.length; column += 1) {
        const stack = stacks[column] ?? [];

        for (let row = 0; row < stack.length; row += 1) {
          writeBlock(column, row * cellSize + cellSize / 2, stack[row] ?? 0);
        }
      }

      for (const block of fallingBlocks) {
        writeBlock(block.column, block.y, block.colorIndex);
      }

      for (const colorMesh of colorMeshes) {
        colorMesh.mesh.count = colorMesh.count;
        colorMesh.mesh.instanceMatrix.needsUpdate = true;
      }

      renderer.render(scene, camera);
    }

    function advanceBlocks(deltaSeconds: number) {
      for (let index = fallingBlocks.length - 1; index >= 0; index -= 1) {
        const block = fallingBlocks[index];

        if (!block) {
          continue;
        }

        block.y -= block.speed * deltaSeconds;

        const targetY = stackHeightFor(block.column) * cellSize + cellSize / 2;

        if (block.y <= targetY) {
          stacks[block.column]?.push(block.colorIndex);
          fallingBlocks.splice(index, 1);
          clearCompletedRows();
          trimTallStacks();
          spawnBlock(index * 0.26);
        }
      }
    }

    function animate(time: number) {
      const deltaSeconds = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0.016;
      previousTime = time;

      advanceBlocks(deltaSeconds);

      if (!previousTimedClear) {
        previousTimedClear = time;
      } else if (time - previousTimedClear >= stackClearIntervalMs) {
        clearBottomRows(1);
        previousTimedClear = time;
      }

      renderBlocks();
      animationFrame = window.requestAnimationFrame(animate);
    }

    function resize() {
      const { height, width } = tetrisContainer.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        return;
      }

      viewportHeight = height;
      columnCount = Math.max(8, Math.floor(width / (width < 768 ? 52 : 72)));
      cellSize = width / columnCount;
      blockSize = cellSize * 1.02;
      maxStackRows = Math.max(5, Math.min(width < 768 ? 8 : 10, Math.floor(height / cellSize) - 3));
      camera.left = 0;
      camera.right = columnCount * cellSize;
      camera.top = height;
      camera.bottom = 0;
      camera.position.set(0, 0, 10);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
      renderer.setSize(width, height, false);

      seedStacks();
      fallingBlocks.length = 0;

      if (!prefersReducedMotion) {
        const activeBlockCount = Math.max(8, Math.min(20, Math.floor(columnCount / 2)));

        for (let index = 0; index < activeBlockCount; index += 1) {
          const block = spawnBlock(index * 0.9);
          block.y = randomBetween(viewportHeight * 0.42, viewportHeight + cellSize * 3.8);
        }
      }

      previousTime = 0;
      previousTimedClear = 0;
      renderBlocks();
    }

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(tetrisContainer);

    if (!prefersReducedMotion) {
      animationFrame = window.requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver.disconnect();
      for (const colorMesh of colorMeshes) {
        scene.remove(colorMesh.mesh);
        colorMesh.material.dispose();
      }

      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="task-market-live-tetris"
      data-testid="live-tetris-background"
      ref={containerRef}
    />
  );
}
