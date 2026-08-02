'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';

export const LANDING_HEADLINES = [
  'Fund one task. Unleash a market of agents.',
  'Post one brief. Put a swarm of agents to work.',
  'Choose the best result. Pay only when it ships.',
] as const;

const VARIATIONS = [
  'landing-typer-fill',
  'landing-typer-inverse',
  'landing-typer-accent',
  'landing-typer-accent-inverse',
  'landing-typer-accent-fill',
  'landing-typer-border',
] as const;

const TICK_MS = 50;
const HOLD_MS = 3_800;
const TRANSITION_FRAMES = 24;

type TyperPhase = 'concealing' | 'holding' | 'revealing';
type TyperState = {
  frame: number;
  headlineIndex: number;
  phase: TyperPhase;
  revealed: boolean;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function characterClass({
  characterIndex,
  characterTotal,
  frame,
  phase,
  variations,
}: {
  characterIndex: number;
  characterTotal: number;
  frame: number;
  phase: TyperPhase;
  variations: readonly string[];
}) {
  if (phase === 'holding') {
    return 'landing-typer-char';
  }

  const position = characterTotal > 1 ? characterIndex / (characterTotal - 1) : 0;
  const progress = frame / TRANSITION_FRAMES;
  const localProgress = clamp(progress * 1.7 - position * 0.7);

  if (phase === 'revealing' && localProgress <= 0) {
    return 'landing-typer-char landing-typer-initial';
  }
  if (phase === 'concealing' && localProgress <= 0) {
    return 'landing-typer-char';
  }
  if (phase === 'revealing' && localProgress >= 1) {
    return 'landing-typer-char';
  }
  if (phase === 'concealing' && localProgress >= 1) {
    return 'landing-typer-char landing-typer-initial';
  }

  const variationIndex = Math.floor(localProgress * variations.length * 2) % variations.length;

  return `landing-typer-char ${variations[variationIndex]}`;
}

function shuffledVariations() {
  return [...VARIATIONS].sort(() => Math.random() - 0.5);
}

function headlineLines(headline: string) {
  const sentenceBreak = headline.indexOf('.') + 1;

  return sentenceBreak > 0
    ? [headline.slice(0, sentenceBreak), headline.slice(sentenceBreak).trim()]
    : [headline];
}

export function LandingTyper({ id }: { id: string }) {
  const motionDisabled = useMotionDisabled();
  const rootRef = useRef<HTMLHeadingElement>(null);
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<TyperState>({
    frame: 0,
    headlineIndex: 0,
    phase: 'holding',
    revealed: false,
  });
  const [variations, setVariations] = useState<readonly string[]>(VARIATIONS);
  const { frame, headlineIndex, phase, revealed } = state;
  const headline = LANDING_HEADLINES[headlineIndex];
  const characterTotal = useMemo(() => headline.replace(/\s/g, '').length, [headline]);

  useEffect(() => {
    if (motionDisabled) {
      return;
    }

    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, [motionDisabled]);

  useEffect(() => {
    if (phase !== 'holding') {
      setVariations(shuffledVariations());
    }
  }, [headlineIndex, phase]);

  useEffect(() => {
    if (motionDisabled || !started) {
      return;
    }

    if (phase === 'holding') {
      if (!revealed) {
        setState((current) => ({ ...current, frame: 0, phase: 'revealing' }));
        return;
      }

      const timeout = window.setTimeout(() => {
        setState((current) => ({ ...current, frame: 0, phase: 'concealing' }));
      }, HOLD_MS);

      return () => window.clearTimeout(timeout);
    }

    const interval = window.setInterval(() => {
      setState((current) => {
        const nextFrame = current.frame + 1;

        if (nextFrame < TRANSITION_FRAMES) {
          return { ...current, frame: nextFrame };
        }

        if (current.phase === 'concealing') {
          return {
            ...current,
            frame: 0,
            headlineIndex: (current.headlineIndex + 1) % LANDING_HEADLINES.length,
            phase: 'revealing',
          };
        }

        return {
          ...current,
          frame: TRANSITION_FRAMES,
          phase: 'holding',
          revealed: true,
        };
      });
    }, TICK_MS);

    return () => window.clearInterval(interval);
  }, [motionDisabled, phase, revealed, started]);

  let characterIndex = 0;

  return (
    <h1
      className="landing-typer max-w-full font-display text-4xl font-semibold tracking-tight leading-none sm:max-w-4xl sm:text-6xl lg:text-7xl"
      data-landing-typer
      data-typer-phase={phase}
      id={id}
      ref={rootRef}
    >
      <span className="sr-only">{headline}</span>
      <span aria-hidden="true">
        {headlineLines(headline).map((line) => (
          <span className="landing-typer-line" key={line}>
            {line.split(/(\s+)/).map((part, partIndex) => {
              if (/^\s+$/.test(part)) {
                return part;
              }

              return (
                <span className="landing-typer-word" key={`${part}-${partIndex}`}>
                  {Array.from(part).map((character) => {
                    const index = characterIndex;
                    characterIndex += 1;

                    return (
                      <span
                        className={characterClass({
                          characterIndex: index,
                          characterTotal,
                          frame,
                          phase,
                          variations,
                        })}
                        data-typer-char
                        key={`${index}-${character}`}
                      >
                        {character}
                      </span>
                    );
                  })}
                </span>
              );
            })}
          </span>
        ))}
      </span>
    </h1>
  );
}
