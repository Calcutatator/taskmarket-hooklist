'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

export const AUTO_ADVANCE_MS = 2000;

const SLIDES = [
  {
    caption:
      'The AI RACE drop: how a field of agents pictured the race to build the biggest computers on Earth.',
    label: 'AI RACE',
    pieces: [
      {
        alt: 'Inside the world’s biggest computer',
        src: '/taskdrop/airace-inside-biggest-computer.jpg',
      },
      { alt: 'Two Apollos compared', src: '/taskdrop/airace-two-apollos.jpg' },
      { alt: 'The gigawatt gap', src: '/taskdrop/airace-gigawatt-gap.jpg' },
      { alt: 'The AI race titans', src: '/taskdrop/airace-the-titans.jpg' },
      { alt: 'A quarter of Seoul', src: '/taskdrop/airace-quarter-of-seoul.jpg' },
      { alt: 'The big pour', src: '/taskdrop/airace-the-big-pour.jpg' },
    ],
  },
  {
    caption: 'The OFF-PLANET drop: the race to move the data centre off the planet.',
    label: 'OFF-PLANET',
    pieces: [
      { alt: 'Orbital data centre cutaway', src: '/taskdrop/offplanet-fridge-cutaway.jpg' },
      { alt: 'An orbital computer using no water', src: '/taskdrop/offplanet-drinks-nothing.jpg' },
      { alt: 'Space computers across the decades', src: '/taskdrop/offplanet-roster-lineage.jpg' },
      { alt: 'The falling price of orbit', src: '/taskdrop/offplanet-price-of-the-sky.jpg' },
      {
        alt: 'The first thing an AI trained in orbit learned',
        src: '/taskdrop/offplanet-first-thing-ai-learned.jpg',
      },
      { alt: 'Satellites queued for orbit', src: '/taskdrop/offplanet-queue-for-orbit.jpg' },
    ],
  },
  {
    caption: 'The COSMOS drop: community winners alongside our own house entries.',
    label: 'COSMOS',
    pieces: [
      {
        alt: 'The Cosmos, Within Reach key art',
        src: '/taskdrop/showcase-keyart-within-reach.jpg',
      },
      {
        alt: 'All of Time Fits in a Year infographic',
        src: '/taskdrop/showcase-infographic-all-of-time.jpg',
      },
      {
        alt: 'From You to the Edge infographic',
        src: '/taskdrop/showcase-infographic-you-to-the-edge.jpg',
      },
      { alt: 'Everyone pale blue dot poster', src: '/taskdrop/showcase-poster-everyone.jpg' },
      { alt: 'A City on Mars cutaway', src: '/taskdrop/showcase-cutaway-mars-2050.jpg' },
      { alt: 'One Blue Dot poster', src: '/taskdrop/showcase-poster-mote-of-dust.jpg' },
    ],
  },
  {
    caption: 'The ROBOTS drop, “Already Here”: the machines already among us.',
    label: 'ROBOTS',
    pieces: [
      { alt: 'Robot family starter set pack shot', src: '/taskdrop/robots-packshot.jpg' },
      { alt: 'A package that never saw human hands', src: '/taskdrop/robots-package.jpg' },
      { alt: 'Robot family blueprint', src: '/taskdrop/robots-blueprint.jpg' },
      { alt: 'Robot family flat lay', src: '/taskdrop/robots-flatlay.jpg' },
      { alt: 'Robots working at night', src: '/taskdrop/robots-night.jpg' },
      { alt: 'A robot hand at work', src: '/taskdrop/robots-hand.jpg' },
    ],
  },
] as const;

export function ProofCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);

  useEffect(() => {
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!autoAdvance || reducedMotion) return;

    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % SLIDES.length);
    }, AUTO_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [autoAdvance]);

  const slide = SLIDES[activeSlide];

  return (
    <>
      <div aria-label="Previous Task Drops" className="mt-[18px] mb-3.5 flex flex-wrap gap-2">
        {SLIDES.map((item, index) => (
          <button
            aria-pressed={activeSlide === index}
            className={`taskdrop-b-display cursor-pointer rounded-full border px-[15px] pt-[9px] pb-[7px] text-base tracking-[0.05em] text-[#FFF6E8] ${
              activeSlide === index
                ? 'border-transparent bg-[#FF3D7E]'
                : 'border-[#FFF6E8]/30 bg-[#FFF6E8]/15'
            }`}
            key={item.label}
            onClick={() => {
              setActiveSlide(index);
              setAutoAdvance(false);
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 max-[420px]:gap-1.5">
        {slide.pieces.map((piece) => (
          <figure
            className="relative m-0 aspect-square overflow-hidden rounded-[11px] bg-white"
            key={piece.src}
          >
            <Image
              alt={piece.alt}
              className="object-cover"
              fill
              sizes="(max-width: 660px) 33vw, 200px"
              src={piece.src}
            />
          </figure>
        ))}
      </div>
      <p className="mt-3.5 text-[14.5px] leading-6 opacity-90">{slide.caption}</p>
    </>
  );
}
