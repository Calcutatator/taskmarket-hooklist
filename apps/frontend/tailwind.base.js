/**
 * Base Tailwind configuration for Clawtasker
 * Maps CSS custom properties to Tailwind color names
 */

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        button: {
          primary: {
            bg: 'rgb(var(--colors-button-primary-bg))',
            hover: 'rgb(var(--colors-button-primary-hover))',
            text: 'rgb(var(--colors-button-primary-text))',
          },
          secondary: {
            bg: 'rgb(var(--colors-button-secondary-bg))',
            hover: 'rgb(var(--colors-button-secondary-hover))',
            text: 'rgb(var(--colors-button-secondary-text))',
          },
          accent: {
            bg: 'rgb(var(--colors-button-accent-bg))',
            hover: 'rgb(var(--colors-button-accent-hover))',
            text: 'rgb(var(--colors-button-accent-text))',
          },
          success: {
            bg: 'rgb(var(--colors-button-success-bg))',
            hover: 'rgb(var(--colors-button-success-hover))',
            text: 'rgb(var(--colors-button-success-text))',
          },
          error: {
            bg: 'rgb(var(--colors-button-error-bg))',
            hover: 'rgb(var(--colors-button-error-hover))',
            text: 'rgb(var(--colors-button-error-text))',
          },
          warning: {
            bg: 'rgb(var(--colors-button-warning-bg))',
            hover: 'rgb(var(--colors-button-warning-hover))',
            text: 'rgb(var(--colors-button-warning-text))',
          },
          info: {
            bg: 'rgb(var(--colors-button-info-bg))',
            hover: 'rgb(var(--colors-button-info-hover))',
            text: 'rgb(var(--colors-button-info-text))',
          },
          link: {
            bg: 'rgb(var(--colors-button-link-bg))',
            hover: 'rgb(var(--colors-button-link-hover))',
            text: 'rgb(var(--colors-button-link-text))',
          },
        },
        background: {
          primary: 'rgb(var(--colors-background-primary))',
          secondary: 'rgb(var(--colors-background-secondary))',
          tertiary: 'rgb(var(--colors-background-tertiary))',
          inverse: 'rgb(var(--colors-background-inverse))',
        },
        text: {
          base: 'rgb(var(--colors-text-base))',
          primary: 'rgb(var(--colors-text-primary))',
          secondary: 'rgb(var(--colors-text-secondary))',
          tertiary: 'rgb(var(--colors-text-tertiary))',
          inverse: 'rgb(var(--colors-text-inverse))',
          accent: 'rgb(var(--colors-text-accent))',
        },
        border: {
          primary: 'rgb(var(--colors-border-primary))',
          secondary: 'rgb(var(--colors-border-secondary))',
          accent: 'rgb(var(--colors-border-accent))',
        },
        state: {
          error: {
            primary: 'rgb(var(--colors-state-error-primary))',
          },
          success: {
            primary: 'rgb(var(--colors-state-success-primary))',
          },
        },
      },
    },
  },
};
