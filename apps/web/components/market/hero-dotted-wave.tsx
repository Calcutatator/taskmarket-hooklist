'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function isTestRuntime() {
  return (
    process.env.NODE_ENV === 'test' ||
    (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom'))
  );
}

function readThemeColor(element: HTMLElement, variableName: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(variableName).trim();

  return value || fallback;
}

function makeDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.height = 64;
  canvas.width = 64;

  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 30);
  gradient.addColorStop(0, 'rgb(255 255 255 / 1)');
  gradient.addColorStop(0.42, 'rgb(255 255 255 / 0.86)');
  gradient.addColorStop(1, 'rgb(255 255 255 / 0)');

  context.fillStyle = gradient;
  context.beginPath();
  context.arc(32, 32, 30, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

export function HeroDottedWave() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || isTestRuntime()) {
      return;
    }

    const waveContainer = container;
    const root = document.documentElement;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dotTexture = makeDotTexture();

    if (!dotTexture) {
      return;
    }

    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      });
    } catch {
      dotTexture.dispose();

      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 12, 2400);
    const geometry = new THREE.BufferGeometry();
    const primary = new THREE.Color(readThemeColor(root, '--primary', '#cc667f'));
    const accent = new THREE.Color(readThemeColor(root, '--accent', '#82b5a9'));
    const foreground = new THREE.Color(readThemeColor(root, '--foreground', '#f7f2ef'));
    const palette = [primary, primary, primary, accent, foreground];
    const material = new THREE.PointsMaterial({
      alphaTest: 0.02,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: dotTexture,
      opacity: 0.82,
      size: 8.2,
      sizeAttenuation: true,
      transparent: true,
      vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    const baseX: number[] = [];
    const baseZ: number[] = [];
    const colorBand: number[] = [];
    const phase: number[] = [];

    let animationFrame = 0;
    let currentDepth = 1400;
    let currentNearZ = 180;
    let dotCount = 0;

    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'task-market-hero-wave-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.setAttribute('data-testid', 'hero-dotted-wave-canvas');
    container.appendChild(renderer.domElement);
    scene.add(points);
    camera.position.set(0, 170, 560);
    camera.lookAt(0, -175, -620);

    function rebuildWave(width: number, height: number) {
      const isMobile = width < 768;
      const gap = isMobile ? 36 : 29;
      const terrainWidth = Math.max(width * (isMobile ? 2.25 : 1.75), isMobile ? 860 : 1320);
      const depth = isMobile ? 1060 : 1480;
      const nearZ = isMobile ? 130 : 190;
      const columns = Math.ceil(terrainWidth / gap) + 1;
      const rows = Math.max(Math.ceil(height / gap) + 20, isMobile ? 36 : 46);
      const positions = new Float32Array(columns * rows * 3);
      const colors = new Float32Array(columns * rows * 3);
      const rowDepth = depth / (rows - 1);

      baseX.length = 0;
      baseZ.length = 0;
      colorBand.length = 0;
      phase.length = 0;
      currentDepth = depth;
      currentNearZ = nearZ;
      dotCount = columns * rows;
      material.size = isMobile ? 7.2 : 8.2;

      for (let row = 0; row < rows; row += 1) {
        const z = nearZ - row * rowDepth;

        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const columnProgress = columns === 1 ? 0.5 : column / (columns - 1);
          const x = (columnProgress - 0.5) * terrainWidth;
          const wavePhase = column * 0.23 + row * 0.41;
          const y =
            -190 +
            Math.sin(x * 0.011 + wavePhase) * 18 +
            Math.cos(z * 0.014 - wavePhase * 0.4) * 12;
          const band = index % 13 === 0 ? 4 : (column + row * 2) % 11 === 0 ? 3 : 0;
          const color = palette[band] ?? primary;

          positions[index * 3] = x;
          positions[index * 3 + 1] = y;
          positions[index * 3 + 2] = z;
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
          baseX[index] = x;
          baseZ[index] = z;
          colorBand[index] = band;
          phase[index] = wavePhase;
        }
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setDrawRange(0, dotCount);
      geometry.computeBoundingSphere();
    }

    function renderWave(time = 0) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;

      if (!position || !colorAttribute) {
        renderer.render(scene, camera);

        return;
      }

      for (let index = 0; index < dotCount; index += 1) {
        const xBase = baseX[index] ?? 0;
        const zBase = baseZ[index] ?? 0;
        const dotPhase = phase[index] ?? 0;
        const zOffset =
          (((zBase - currentNearZ - time * 0.035 - dotPhase * 18) % currentDepth) + currentDepth) %
          currentDepth;
        const z = currentNearZ - zOffset;
        const x = xBase + Math.sin(z * 0.006 + time * 0.00022 + dotPhase) * 8;
        const y =
          -190 +
          Math.sin(xBase * 0.012 + time * 0.00058 + dotPhase) * 28 +
          Math.sin(z * 0.017 - time * 0.00042) * 20 +
          Math.cos((xBase + z) * 0.006 + time * 0.00032) * 11;
        const depthProgress = THREE.MathUtils.clamp((z + currentDepth) / currentDepth, 0, 1);
        const horizonFade = THREE.MathUtils.smoothstep(depthProgress, 0.08, 0.72);
        const nearFade = 1 - THREE.MathUtils.smoothstep(depthProgress, 0.91, 1);
        const scanZ = currentNearZ - ((time * 0.11) % currentDepth);
        const scanPulse = Math.max(0, 1 - Math.abs(z - scanZ) / 74);
        const wavePulse = (Math.sin(xBase * 0.018 + z * 0.014 + time * 0.001) + 1) * 0.5;
        const brightness =
          (0.16 + horizonFade * 0.68 + scanPulse * 0.5 + wavePulse * 0.12) * nearFade;
        const baseColor = palette[colorBand[index] ?? 0] ?? primary;

        position.setX(index, x);
        position.setY(index, y);
        position.setZ(index, z);
        colorAttribute.setXYZ(
          index,
          Math.min(1, baseColor.r * brightness + primary.r * scanPulse * 0.45),
          Math.min(1, baseColor.g * brightness + primary.g * scanPulse * 0.25),
          Math.min(1, baseColor.b * brightness + primary.b * scanPulse * 0.55)
        );
      }

      position.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      points.rotation.x = Math.sin(time * 0.00008) * 0.018;
      points.rotation.z = Math.sin(time * 0.0001) * 0.018;
      renderer.render(scene, camera);
    }

    function resize() {
      const { height, width } = waveContainer.getBoundingClientRect();

      if (width <= 0 || height <= 0) {
        return;
      }

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
      renderer.setSize(width, height, false);
      rebuildWave(width, height);
      renderWave();
    }

    function animate(time: number) {
      renderWave(time);
      animationFrame = window.requestAnimationFrame(animate);
    }

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(waveContainer);

    if (!prefersReducedMotion) {
      animationFrame = window.requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver.disconnect();
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      dotTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="task-market-hero-wave"
      data-testid="hero-dotted-wave"
      ref={containerRef}
    />
  );
}
